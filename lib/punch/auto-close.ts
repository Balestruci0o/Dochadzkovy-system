import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
// eslint-disable-next-line no-restricted-imports -- cron beží bez prihláseného používateľa, žiadny app.user_id neexistuje (architektura.md, service role výnimka pre cron joby)
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  employeePositionHistory,
  employees,
  managerWorkplaces,
  notifications,
  positions,
  punchEvents,
  scheduledShifts,
} from "@/lib/db/schema";
import { resolveDepartureMode } from "@/lib/scheduler/departure-mode";
import { addDays } from "@/lib/shared/dates";
import { localDateStr, zonedTimeToUtc } from "@/lib/shared/time";
import { filterActiveEventsForLocalDate, localDateWindowUtc, recomputeAttendanceDay } from "./attendance";

/**
 * ULOHY.md 7f — ZÁSADNÁ ZMENA POLITIKY (po Bloku 8, 🔍): predtým tento cron
 * uzavrel KAŽDÚ zabudnutú zmenu na plánovaný koniec (alebo 23:59 fallback) —
 * to bolo DOMÝŠĽANIE bez dôkazu, ktoré do mzdových podkladov vpisovalo hodiny,
 * čo sa reálne nemuseli odpracovať.
 *
 * Režim odchodu (pípa/nepípa) — DVE USPORIADANÉ, nesúperiace podmienky
 * uzavretia (nie dva mechanizmy vedľa seba):
 *
 * 1. PRESTÁVKOVÝ DÔKAZ (nezmenené, platí pre VŠETKÝCH nezávisle od režimu
 *    odchodu) — zamestnanec odišiel na PRESTÁVKU (posledné 'prestavka'
 *    razítko dňa je 'out') a nevrátil sa. Máme istotu, že do toho momentu
 *    tam ešte bol, `actualEnd` = presne ten čas. Toto je dôkaz, nie hádanie
 *    (CLAUDE.md princíp 7) — preto platí bez ohľadu na to, či si zamestnanec
 *    inak pípa odchod sám ("pipa") alebo nie ("nepipa").
 *
 * 2. REŽIM ODCHODU "nepipa" (nová podmienka, DOPĹŇA #1, nenahrádza) —
 *    zamestnanec pípol PRÍCHOD (inak by `attendance_days.status` vôbec
 *    nebolo 'working', viď `calculateAttendanceDay`), nepípol odchod, #1
 *    sa naň nevzťahuje (žiadny problém s prestávkou), a jeho vyriešený
 *    `departure_mode` (positions.departure_mode / employees.override_*,
 *    `resolveDepartureMode`) je "nepipa" → uzavrie sa na KONCI PLÁNOVANEJ
 *    zmeny (`scheduled_shifts.end_time`, s ohľadom na `crosses_midnight`).
 *    Bez priradenej zmeny v ten deň sa NEUZAVIERA (niet z čoho vziať
 *    "plánovaný koniec" — CLAUDE.md princíp 7, radšej nič než domýšľanie).
 *
 *    STRÁŽ proti predčasnému uzavretiu (nočné/crossesMidnight zmeny): cron
 *    beží raz denne skoro po polnoci a jeho dátumový filter (`date < dnes`)
 *    by inak pustil aj zmenu, ktorá reálne ešte BEŽÍ (začala včera, plánovaný
 *    koniec je až dnes ráno, napr. 06:00 — cron o 00:05 UTC to stihne PRED
 *    týmto koncom). Preto sa zatvorí LEN keď `now >= plánovaný koniec`
 *    (rovnaký výpočet ako `plannedEndInstant` v `lib/payroll/calculate.ts`).
 *    Dôsledok: takáto nočná zmena sa uzavrie až NASLEDUJÚCI beh cronu (o deň
 *    neskôr) — radšej deň meškania než vymyslené hodiny.
 *
 * "pipa" (default, dnešné správanie zachované) — bez problému s prestávkou
 * ostáva zmena OTVORENÁ (`status: 'working'`) NAVŽDY, kým ju manažér ručne
 * neopraví. Žiadny fallback na plannedEnd/23:59 pre pípajúcich.
 *
 * Manuálny odchod má VŽDY prednosť pred oboma auto-podmienkami — akonáhle
 * zamestnanec pípne skutočný odchod, `recomputeAttendanceDay` nastaví
 * `status: 'done'` (má `actualEnd`), takže tento cron taký riadok už vôbec
 * nevyberie (`WHERE status = 'working'`) — žiadny dvojitý 'out' nehrozí,
 * bez potreby špeciálnej výnimky.
 *
 * `now` — voliteľný, injektovateľný (deterministické testy stráže vyššie),
 * v produkcii vždy `new Date()` (rovnaký vzor ako `calculateAttendanceDay`).
 *
 * Dopyt na `stale` je ZÁMERNE bez org/workplace filtra — toto je globálny
 * systémový cron (jeden `CRON_SECRET`, jedno vyvolanie pre celý systém, nie
 * per-org endpoint), takže MUSÍ prejsť všetky organizácie v jednom behu; per-org
 * scoping by tu nič nechránilo (adminDb aj tak beží mimo RLS) a len by
 * multiplikoval počet behov bez úžitku.
 *
 * Dávkovanie — JEDEN dopyt PER DISTINCT DÁTUM (nie per riadok), pokrývajúci
 * všetkých zamestnancov s otvorenou zmenou v ten deň naraz: prestávkové
 * udalosti aj naplánované zmeny sa dotiahnu hromadne, rovnaký vzor ako
 * pôvodná optimalizácia (OTAZKY.md #56). Režim odchodu (závisí len od
 * zamestnanca/pozície, nie od dátumu) sa dotiahne JEDNÝM dopytom pre všetky
 * dotknuté `employeeId` naraz, mimo per-dátumovej slučky.
 */
export async function runAutoClose(now: Date = new Date()): Promise<{ closedCount: number }> {
  const todayStr = localDateStr(now);

  const stale = await adminDb
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.status, "working"), lt(attendanceDays.date, todayStr)));

  let closedCount = 0;
  if (stale.length === 0) return { closedCount };

  const staleByDate = new Map<string, typeof stale>();
  for (const day of stale) {
    const forDate = staleByDate.get(day.date);
    if (forDate) forDate.push(day);
    else staleByDate.set(day.date, [day]);
  }

  // `employeeId|workplaceId|date` → posledná AKTÍVNA 'prestavka' udalosť toho dňa (ak existuje).
  const lastBreakByRow = new Map<string, { direction: "in" | "out"; occurredAt: Date }>();
  // `employeeId|workplaceId|date` → naplánovaná zmena toho dňa (ak existuje).
  const shiftByRow = new Map<string, { endTime: string; crossesMidnight: boolean }>();

  for (const [date, daysOnThisDate] of staleByDate) {
    const employeeIds = [...new Set(daysOnThisDate.map((d) => d.employeeId))];
    const { windowStart, windowEnd } = localDateWindowUtc(date);

    const breakEvents = await adminDb
      .select()
      .from(punchEvents)
      .where(
        and(
          inArray(punchEvents.employeeId, employeeIds),
          eq(punchEvents.kind, "prestavka"),
          gte(punchEvents.occurredAt, windowStart),
          lt(punchEvents.occurredAt, windowEnd),
        ),
      )
      .orderBy(asc(punchEvents.occurredAt));

    const byEmployeeWorkplace = new Map<string, typeof breakEvents>();
    for (const e of breakEvents) {
      const key = `${e.employeeId}|${e.workplaceId}`;
      const forKey = byEmployeeWorkplace.get(key);
      if (forKey) forKey.push(e);
      else byEmployeeWorkplace.set(key, [e]);
    }

    for (const day of daysOnThisDate) {
      const rowsForRow = byEmployeeWorkplace.get(`${day.employeeId}|${day.workplaceId}`) ?? [];
      const lastBreak = filterActiveEventsForLocalDate(rowsForRow, date).at(-1);
      if (lastBreak) lastBreakByRow.set(`${day.employeeId}|${day.workplaceId}|${day.date}`, lastBreak);
    }

    const shiftsToday = await adminDb
      .select({
        employeeId: scheduledShifts.employeeId,
        workplaceId: scheduledShifts.workplaceId,
        endTime: scheduledShifts.endTime,
        crossesMidnight: scheduledShifts.crossesMidnight,
      })
      .from(scheduledShifts)
      .where(and(inArray(scheduledShifts.employeeId, employeeIds), eq(scheduledShifts.date, date)));
    for (const s of shiftsToday) {
      shiftByRow.set(`${s.employeeId}|${s.workplaceId}|${date}`, s);
    }
  }

  // Režim odchodu per zamestnanec — jeden dopyt pre všetky, mimo dátumovej slučky (nezávisí od dátumu).
  const allEmployeeIds = [...new Set(stale.map((d) => d.employeeId))];
  const empOverrides = await adminDb
    .select({ id: employees.id, overrideDepartureMode: employees.overrideDepartureMode })
    .from(employees)
    .where(inArray(employees.id, allEmployeeIds));
  const positionRows = await adminDb
    .select({ employeeId: employeePositionHistory.employeeId, departureMode: positions.departureMode })
    .from(employeePositionHistory)
    .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
    .where(and(inArray(employeePositionHistory.employeeId, allEmployeeIds), isNull(employeePositionHistory.validTo)));
  const positionByEmployee = new Map(positionRows.map((r) => [r.employeeId, r.departureMode]));
  const departureModeByEmployee = new Map(
    empOverrides.map((e) => [
      e.id,
      resolveDepartureMode(
        positionByEmployee.has(e.id) ? { departureMode: positionByEmployee.get(e.id)! } : null,
        { overrideDepartureMode: e.overrideDepartureMode },
      ),
    ]),
  );

  for (const day of stale) {
    const rowKey = `${day.employeeId}|${day.workplaceId}|${day.date}`;
    const lastBreak = lastBreakByRow.get(rowKey);

    let closeAt: Date | null = null;
    let reason: "prestavka_no_return" | "nepipa_planned_end" | null = null;

    if (lastBreak?.direction === "out") {
      // Podmienka 1 — prestávkový dôkaz, platí pre VŠETKÝCH.
      closeAt = lastBreak.occurredAt;
      reason = "prestavka_no_return";
    } else {
      // Podmienka 2 — "nepipa" + priradená zmena + jej koniec už NASTAL.
      const shift = shiftByRow.get(rowKey);
      const mode = departureModeByEmployee.get(day.employeeId) ?? "pipa";
      if (shift && mode === "nepipa") {
        const plannedEndInstant = zonedTimeToUtc(
          shift.crossesMidnight ? addDays(day.date, 1) : day.date,
          shift.endTime,
        );
        if (now.getTime() >= plannedEndInstant.getTime()) {
          closeAt = plannedEndInstant;
          reason = "nepipa_planned_end";
        }
      }
    }

    if (!closeAt || !reason) continue;

    await adminDb.transaction(async (tx) => {
      await tx.insert(punchEvents).values({
        employeeId: day.employeeId,
        workplaceId: day.workplaceId,
        direction: "out",
        method: "auto_close",
        occurredAt: closeAt,
      });
      await recomputeAttendanceDay(tx, day.employeeId, day.workplaceId, day.date);
      // recomputeAttendanceDay by z in+out odvodilo status 'done' — toto ALE
      // nebol skutočný odpip, prepíšeme na 'auto_closed' nech je rozdiel vidno.
      await tx.update(attendanceDays).set({ status: "auto_closed" }).where(eq(attendanceDays.id, day.id));
    });

    const [employee] = await adminDb
      .select({ userId: employees.userId, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(eq(employees.id, day.employeeId));

    const title = reason === "prestavka_no_return" ? "Zabudnutý návrat z prestávky" : "Automaticky uzavretá zmena";
    const employeeBody =
      reason === "prestavka_no_return"
        ? `Za ${day.date} sme dochádzku automaticky uzavreli na čas odchodu na prestávku, keďže si sa už nevrátil/a.`
        : `Za ${day.date} sme dochádzku automaticky uzavreli na koniec plánovanej zmeny, keďže si nepípol/a odchod.`;

    const notifRows: { userId: string; kind: string; title: string; body: string; link: string }[] = [];
    if (employee?.userId) {
      notifRows.push({ userId: employee.userId, kind: "auto_closed", title, body: employeeBody, link: "/moja-dochadzka" });
    }

    const managers = await adminDb
      .select({ userId: managerWorkplaces.userId })
      .from(managerWorkplaces)
      .where(eq(managerWorkplaces.workplaceId, day.workplaceId));
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : "Zamestnanec";
    const managerBody =
      reason === "prestavka_no_return"
        ? `${employeeName} — dochádzka za ${day.date} bola automaticky uzavretá na čas odchodu na prestávku (bez návratu).`
        : `${employeeName} — dochádzka za ${day.date} bola automaticky uzavretá na koniec plánovanej zmeny (nepípol/a odchod).`;
    for (const m of managers) {
      notifRows.push({ userId: m.userId, kind: "auto_closed", title, body: managerBody, link: "/dnes" });
    }

    if (notifRows.length > 0) {
      await adminDb.insert(notifications).values(notifRows);
    }

    closedCount++;
  }

  return { closedCount };
}

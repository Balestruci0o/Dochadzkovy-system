import { and, asc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
// eslint-disable-next-line no-restricted-imports -- viď komentár pri použití nižšie (yesterdayShift): interný, na-vlastných-dátach-založený lookup, nesmie závisieť od toho, či je volajúci pod zamestnancovou RLS session.
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  employeePositionHistory,
  employees,
  holidays,
  legalRules,
  positions,
  punchEvents,
  scheduledShifts,
  workplaces,
} from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { calculateAttendanceDay } from "@/lib/payroll/calculate";
import type { PunchKind } from "@/lib/punch/qr-token";
import { resolveBreakTrackingMode } from "@/lib/scheduler/break-tracking-mode";
import { addDays } from "@/lib/shared/dates";
import { localDateStr } from "@/lib/shared/time";

type Db = PostgresJsDatabase<typeof schema>;

export type DirectionResolution = {
  direction: "in" | "out";
  /**
   * Deň, ku ktorému treba prepočítať `attendance_days` — zvyčajne dnešok
   * (`dateStr`). VÝNIMKA: ranné odpípanie NOČNEJ (crossesMidnight) zmeny —
   * vtedy je to VČEREJŠOK (deň, ku ktorému patrí `scheduled_shift` aj celá
   * zmena). Bez tohto rozlíšenia by `recomputeAttendanceDay` dostal nesprávny
   * dátum a zmena by sa nikdy nespočítala (viď dokumentácia nižšie).
   */
  attendanceDate: string;
};

/**
 * Smer nového razítka podľa POSLEDNÉHO razítka toho istého zamestnanca v ten
 * istý lokálny deň. Žiadne predošlé razítko dnes → 'in'.
 *
 * VÝNIMKA (nočná/crossesMidnight zmena) — nájdený bug pred Blokom 12: keby
 * sa smer rozhodoval VÝHRADNE podľa dnešných udalostí, ranné odpípanie
 * odchodu z nočnej zmeny (napr. príchod 22:00 včera, odchod 06:00 dnes) by
 * dnešok videl prázdny → mylne vyhodnotené ako NOVÝ príchod, nie odchod.
 * Preto: keď dnešok nemá ŽIADNE udalosti, over VČEREJŠÍ `scheduled_shift` —
 * ak je `crossesMidnight=true` A jeho posledná udalosť je 'in' (ešte
 * nezavretá), toto razítko je jeho 'out' a prepočítať treba VČEREJŠOK, nie
 * dnešok (`scheduled_shift`/`attendance_days` riadok tejto zmeny žije pod
 * dátumom začiatku zmeny).
 *
 * Pípanie prestávok, krok 3 — `kind` ("zmena"/"prestavka") prepína smer
 * NEZÁVISLE: príchod na zmenu a odchod na prestávku sú DVE oddelené
 * in/out sekvencie v tom istom dni, nie jedna zdieľaná (`eventsForLocalDate`
 * filtruje na daný `kind`). Nočná crossesMidnight výnimka vyššie platí LEN
 * pre `kind: "zmena"` — prestávka cez polnoc nie je podporovaný prípad
 * (mimo rozsahu zadania), pre "prestavka" sa vždy rieši len v rámci toho
 * istého lokálneho dňa.
 *
 * DEFAULT smer (žiadne predošlé razítko tohto kind dnes) sa LÍŠI podľa kind:
 * "zmena" → 'in' (prvé, čo zamestnanec urobí, je príchod). "prestavka" → 'out'
 * (prvé, čo urobí s prestávkovým QR, je ODCHOD na prestávku — opačný default
 * ako pri zmene, nie tá istá konštanta).
 */
export async function determineDirection(
  tx: Db,
  employeeId: string,
  workplaceId: string,
  dateStr: string,
  kind: PunchKind = "zmena",
): Promise<DirectionResolution> {
  const events = await eventsForLocalDate(tx, employeeId, workplaceId, dateStr, kind);
  const last = events.at(-1);
  if (last) {
    return { direction: last.direction === "out" ? "in" : "out", attendanceDate: dateStr };
  }

  if (kind === "zmena") {
    const yesterday = addDays(dateStr, -1);
    // ZÁMERNE adminDb, nie `tx` — táto funkcia sa volá AJ pod vlastnou RLS
    // session zamestnanca (moja-dochadzka/data.ts, len na popisok tlačidla).
    // `sched_select` (0041) pustí zamestnanca k VLASTNÉMU `scheduled_shifts`
    // riadku len keď je jeho mesiac `published` — keby mesiac medzitým
    // pregenerovali na draft (obsah smeny sa tým nemení, len status), tento
    // lookup by pod RLS nenašiel VČEREJŠIU (už ODPÍPANÚ) smenu a spočítal by
    // ZLÝ smer/deň na tlačidle (napr. "Pípnuť príchod" namiesto "Pípnuť
    // odchod") — zamestnanec by dostal opačný popisok, než čo sa skutočne
    // zapíše (samotný zápis ide vždy cez adminDb, tam RLS nikdy neprekážalo).
    // Toto NIE JE únik draftu zamestnancovi — nejde o zobrazenie obsahu
    // rozvrhu, len o interné overenie "má VČERAJŠIA VLASTNÁ zmena crossesMidnight",
    // aby popisok tlačidla sedel s tým, čo sa reálne zapíše.
    const [yesterdayShift] = await adminDb
      .select({ id: scheduledShifts.id })
      .from(scheduledShifts)
      .where(
        and(
          eq(scheduledShifts.employeeId, employeeId),
          eq(scheduledShifts.workplaceId, workplaceId),
          eq(scheduledShifts.date, yesterday),
          eq(scheduledShifts.crossesMidnight, true),
        ),
      );

    if (yesterdayShift) {
      const yesterdayEvents = await eventsForLocalDate(tx, employeeId, workplaceId, yesterday, kind);
      const lastYesterday = yesterdayEvents.at(-1);
      if (lastYesterday?.direction === "in") {
        return { direction: "out", attendanceDate: yesterday };
      }
    }
  }

  return { direction: kind === "prestavka" ? "out" : "in", attendanceDate: dateStr };
}

/**
 * occurred_at je timestamptz, "deň" je lokálny pojem (Europe/Bratislava) —
 * širšie okno (UTC-6h .. UTC+30h pokrýva celý deň pri hociktorom posune voči
 * UTC vrátane DST), presné vyfiltrovanie na `dateStr` ide cez `localDateStr`
 * (viď `filterActiveEventsForLocalDate`). Vytiahnuté zo `eventsForLocalDate`,
 * aby si dávkové volania (napr. `runAutoClose`) vedeli spočítať SPOLOČNÉ
 * okno pre viacero dní naraz, bez duplikovania tejto konštanty na dvoch miestach.
 */
export function localDateWindowUtc(dateStr: string): { windowStart: Date; windowEnd: Date } {
  const dayStartUtc = new Date(`${dateStr}T00:00:00Z`);
  return {
    windowStart: new Date(dayStartUtc.getTime() - 6 * 3600 * 1000),
    windowEnd: new Date(dayStartUtc.getTime() + 30 * 3600 * 1000),
  };
}

/**
 * Čistá filtrovacia časť `eventsForLocalDate` (žiadny DB dopyt) — z už
 * natiahnutých riadkov vynechá anulované (`is_void`, granulárne "zmazanie")
 * aj nahradené (`corrects_event_id`) udalosti a necháva len tie,
 * čo lokálne padajú do `dateStr`. Pôvodná udalosť v `punch_events` ZOSTÁVA
 * navždy (append-only) — len sa vynechá z výpočtu, opravná ju nahrádza.
 *
 * Oddelené od DB fetchu zámerne — dávkové volania (napr. `runAutoClose`,
 * ktoré potrebuje tento filter pre STOVKY riadkov naraz) si vedia natiahnuť
 * dáta JEDNÝM hromadným dopytom namiesto volania `eventsForLocalDate` v cykle
 * (jeden round-trip na riadok), a použiť presne TÚTO istú logiku na výsledok.
 */
export function filterActiveEventsForLocalDate<
  T extends { id: number; correctsEventId: number | null; isVoid: boolean; occurredAt: Date },
>(rows: T[], dateStr: string): T[] {
  const superseded = new Set(rows.filter((r) => r.correctsEventId != null).map((r) => r.correctsEventId));
  return rows.filter((r) => !r.isVoid && !superseded.has(r.id) && localDateStr(r.occurredAt) === dateStr);
}

/**
 * Všetky razítka zamestnanca DANÉHO `kind` ("zmena"/"prestavka" — pípanie
 * prestávok, krok 3), ktoré lokálne padajú do daného dňa, zoradené
 * chronologicky — OKREM tých, ktoré nahradila opravná udalosť
 * (`corrects_event_id`). Pôvodná udalosť v `punch_events`
 * ZOSTÁVA navždy (append-only, nikdy sa needituje/nemaže), len sa vynechá z
 * výpočtu dochádzky — opravná udalosť ju pre tento účel nahrádza. Exportované
 * aj pre schvaľovanie opravy (`/dnes` akcie) — potrebuje nájsť PÔVODNÚ
 * (ešte nenahradenú) udalosť, na ktorú sa má nová oprava odkázať.
 */
export async function eventsForLocalDate(
  tx: Db,
  employeeId: string,
  workplaceId: string,
  dateStr: string,
  kind: PunchKind = "zmena",
) {
  const { windowStart, windowEnd } = localDateWindowUtc(dateStr);

  const rows = await tx
    .select()
    .from(punchEvents)
    .where(
      and(
        eq(punchEvents.employeeId, employeeId),
        eq(punchEvents.workplaceId, workplaceId),
        eq(punchEvents.kind, kind),
        gte(punchEvents.occurredAt, windowStart),
        lt(punchEvents.occurredAt, windowEnd),
      ),
    )
    .orderBy(asc(punchEvents.occurredAt));

  return filterActiveEventsForLocalDate(rows, dateStr);
}

/**
 * Pípanie prestávok, krok 4 — spáruje "prestavka" razítka dňa do intervalov
 * {start, end}. `determineDirection` zaručuje prísne striedanie začínajúce
 * "out" (viď vyššie), takže párovanie je vždy out→in, out→in, ... Posledné
 * nespárované "out" (zamestnanec sa ešte nevrátil / auto-close ho zastihol
 * na prestávke) dostane `end: null` — `realBreakMinutes` v calculate.ts ho
 * dorieši oproti `actualEnd`. Exportované aj pre `live-worked-hours.ts`
 * (naživo zobrazené odpracované hodiny pri ešte OTVORENEJ zmene) — rovnaké
 * párovanie, iný spotrebiteľ.
 */
export function pairBreakPunches(events: { direction: "in" | "out"; occurredAt: Date }[]): { start: Date; end: Date | null }[] {
  const pairs: { start: Date; end: Date | null }[] = [];
  let openStart: Date | null = null;
  for (const e of events) {
    if (e.direction === "out") {
      if (openStart === null) openStart = e.occurredAt;
    } else if (openStart !== null) {
      pairs.push({ start: openStart, end: e.occurredAt });
      openStart = null;
    }
  }
  if (openStart !== null) pairs.push({ start: openStart, end: null });
  return pairs;
}

/**
 * Prepočíta `attendance_days` z aktuálnej sady razítok daného dňa (nie
 * inkrementálne) — robustné aj voči offline synchronizácii, ktorá môže
 * doručiť razítko so starším `occurred_at` PO tom, čo už bolo novšie
 * spracované online.
 *
 * Presný výpočet (od plánovaného začiatku, prestávka podľa šablóny, nadčas,
 * sviatky/víkendy, letný/zimný čas) je v `lib/payroll/calculate.ts`
 * (Blok 8, 🔍) — táto funkcia len pripraví vstupy z DB (razítka, naplánovaná
 * zmena, sviatky) a zapíše výsledok.
 *
 * Nájdený bug pred Blokom 12: `eventsForLocalDate` je zámerne scoped na
 * JEDEN lokálny kalendárny deň (append-only korekcie), ale
 * NOČNÁ (crossesMidnight) zmena má príchod a odchod na DVOCH rôznych dňoch —
 * `dateStr`-ové udalosti samé osebe nikdy neobsahujú "out" takejto zmeny.
 * Keď `scheduled_shift` hovorí `crossesMidnight=true`, dotiahni AJ nasledujúci
 * deň a zober jeho PRVÝ "out" (nie posledný — to by mohla byť už ĎALŠIA,
 * nadväzujúca zmena toho istého dňa, ktorá s TOUTO nočnou nemá nič spoločné).
 */
export async function recomputeAttendanceDay(
  tx: Db,
  employeeId: string,
  workplaceId: string,
  dateStr: string,
): Promise<void> {
  const [shift] = await tx
    .select()
    .from(scheduledShifts)
    .where(
      and(
        eq(scheduledShifts.employeeId, employeeId),
        eq(scheduledShifts.workplaceId, workplaceId),
        eq(scheduledShifts.date, dateStr),
      ),
    );
  const crossesMidnight = shift?.crossesMidnight ?? false;

  const sameDayEvents = await eventsForLocalDate(tx, employeeId, workplaceId, dateStr);
  const firstIn = sameDayEvents.find((e) => e.direction === "in");
  const sameDayLastOut = [...sameDayEvents].reverse().find((e) => e.direction === "out");

  const nextDayFirstOut = crossesMidnight
    ? (await eventsForLocalDate(tx, employeeId, workplaceId, addDays(dateStr, 1))).find((e) => e.direction === "out")
    : undefined;
  const lastOut = nextDayFirstOut ?? sameDayLastOut;

  const actualStart = firstIn?.occurredAt ?? null;
  const actualEnd = lastOut && lastOut.occurredAt > (actualStart ?? new Date(0)) ? lastOut.occurredAt : null;
  const breakMinutes = shift?.breakMinutes ?? 0;

  // Pípanie prestávok, krok 4 — režim ("automaticky"/"pipa") je na POZÍCII,
  // zamestnanec ho smie prepísať (rovnaký vzor ako work_time_mode).
  const [employeeRow] = await tx
    .select({ overrideBreakTrackingMode: employees.overrideBreakTrackingMode })
    .from(employees)
    .where(eq(employees.id, employeeId));
  const [currentPosition] = await tx
    .select({ breakTrackingMode: positions.breakTrackingMode })
    .from(employeePositionHistory)
    .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
    .where(and(eq(employeePositionHistory.employeeId, employeeId), isNull(employeePositionHistory.validTo)));
  const breakTrackingMode = resolveBreakTrackingMode(currentPosition ?? null, {
    overrideBreakTrackingMode: employeeRow?.overrideBreakTrackingMode ?? null,
  });
  const breakPunches = pairBreakPunches(await eventsForLocalDate(tx, employeeId, workplaceId, dateStr, "prestavka"));

  const relevantDates = crossesMidnight ? [dateStr, addDays(dateStr, 1)] : [dateStr];
  const holidayRows = await tx.select({ date: holidays.date }).from(holidays).where(inArray(holidays.date, relevantDates));
  const holidaySet = new Set(holidayRows.map((h) => h.date));

  // Blok 12 — hranica nočnej práce (§123 ZP) je legal_rules riadok,
  // nie zadrátovaná konštanta. Org bez aktívneho riadku (zatiaľ)
  // → nightWindow=null → calculateAttendanceDay vráti nightHours=0, žiadny pád.
  const [workplace] = await tx.select({ orgId: workplaces.orgId }).from(workplaces).where(eq(workplaces.id, workplaceId));
  const [nightRule] = workplace
    ? await tx
        .select({ params: legalRules.params })
        .from(legalRules)
        .where(and(eq(legalRules.orgId, workplace.orgId), eq(legalRules.code, "NIGHT_HOURS"), eq(legalRules.isActive, true)))
    : [];
  const nightWindow = nightRule ? (nightRule.params as { from: string; to: string }) : null;

  const calc = calculateAttendanceDay({
    actualStart,
    actualEnd,
    plannedStart: shift?.startTime ?? null,
    plannedEnd: shift?.endTime ?? null,
    breakMinutes,
    breakTrackingMode,
    breakPunches,
    crossesMidnight,
    date: dateStr,
    isHoliday: (d) => holidaySet.has(d),
    nightWindow,
    now: new Date(),
  });

  const [existing] = await tx
    .select({ id: attendanceDays.id })
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, dateStr)));

  const values = {
    employeeId,
    workplaceId,
    date: dateStr,
    scheduledShiftId: shift?.id ?? null,
    plannedStart: shift?.startTime ?? null,
    plannedEnd: shift?.endTime ?? null,
    actualStart,
    actualEnd,
    // Pípanie prestávok, krok 4 — SKUTOČNE použitá hodnota (config, alebo
    // súčet reálnych prestávok pri "pipa"), nie surová konfigurácia zo
    // šablóny — presne to, z čoho calc.workedHours vyšlo. `integer` stĺpec —
    // reálne prestávky sa nemusia trafiť presne na minútu.
    breakMinutes: Math.round(calc.effectiveBreakMinutes),
    workedHours: calc.workedHours.toFixed(3),
    overtimeHours: calc.overtimeHours.toFixed(3),
    weekendHours: calc.weekendHours.toFixed(3),
    holidayHours: calc.holidayHours.toFixed(3),
    nightHours: calc.nightHours.toFixed(3),
    isLate: calc.isLate,
    lateMinutes: calc.lateMinutes,
    status: calc.status,
    updatedAt: new Date(),
  };

  if (existing) {
    await tx.update(attendanceDays).set(values).where(eq(attendanceDays.id, existing.id));
  } else {
    await tx.insert(attendanceDays).values(values);
  }
}

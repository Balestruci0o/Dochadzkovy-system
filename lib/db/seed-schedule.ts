import { and, eq } from "drizzle-orm";
import { adminDb } from "./admin";
import { recomputeAttendanceDay } from "../punch/attendance";
import { runGenerateAsCron } from "../scheduler/run-generate";
import { zonedTimeToUtc } from "../shared/time";
import {
  absenceRequests,
  coverageRequirements,
  employeePositionHistory,
  managerPermissions,
  missingPunchRequests,
  publishedShifts,
  punchEvents,
  scheduledShifts,
  schedules,
  shiftTemplates,
} from "./schema";

/**
 * Fáza L, balík L4 — realistický mesiac demo dát nad rámec základného seedu
 * (org/prevádzky/pozície/ľudia v `seed.ts`), presne pre potreby screenshotov
 * nápovede (`public/help/screenshots/README.md`). Volané VÝHRADNE zo
 * `seed.ts`, po založení základných dát — POVOLENÁ zmena kódu podľa zadania
 * Fázy L (L4). Poistky `seed.ts` (odmietnutie v produkcii, odmietnutie nad
 * neprázdnou DB) platia rovnako pre celý beh, tento súbor ich neobchádza.
 */

// Kód (nie `name`) sa v kalendári vykresľuje do pevnej 28px značky
// (`components/calendar/team-calendar.tsx`, `CellContent`, `w-7 h-6`) —
// "RANNA"/"DENNA" (5 znakov) sa tam nezmestí a pri plnom mesiaci vizuálne
// pretečie do susedného dňa (nález Fázy S, zapísaný v NALEZY.md). Krátky
// kód (2-3 znaky) je presne to, čo si aj `nastavenia-zmeny-clanok`
// v `lib/help/content.ts` vizuálne sľubuje.
const HOTEL_SHIFT = { name: "Ranná", code: "RAN", startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30, color: "#7E9082" };
const OFFICE_SHIFT = { name: "Denná", code: "DEN", startTime: "08:00:00", endTime: "16:00:00", breakMinutes: 30, color: "#E0700F" };

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

export type SeedScheduleContext = {
  hotelId: string;
  officeId: string;
  recepciaId: string;
  chyznaId: string;
  ucotvnikId: string;
  ownerUserId: string;
  managerHotelUserId: string;
  janaId: string;
  peterId: string;
  zuzanaId: string;
  katarinaId: string;
};

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function shiftMonth(year: number, month: number, delta: 1): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + delta };
}

function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `runGenerateAsCron` už schedule riadok založil (`persistGenerateResult`) — tu ho len nájdeme, nezakladáme znova. */
async function findScheduleOrThrow(workplaceId: string, year: number, month: number): Promise<typeof schedules.$inferSelect> {
  const [row] = await adminDb
    .select()
    .from(schedules)
    .where(and(eq(schedules.workplaceId, workplaceId), eq(schedules.year, year), eq(schedules.month, month)));
  if (!row) throw new Error(`schedules riadok pre workplace ${workplaceId} ${year}-${month} neexistuje — mal ho založiť runGenerateAsCron.`);
  return row;
}

async function publishSchedule(workplaceId: string, year: number, month: number, publishedBy: string): Promise<void> {
  const schedule = await findScheduleOrThrow(workplaceId, year, month);
  const currentShifts = await adminDb.select().from(scheduledShifts).where(eq(scheduledShifts.scheduleId, schedule.id));
  await adminDb.delete(publishedShifts).where(eq(publishedShifts.scheduleId, schedule.id));
  if (currentShifts.length > 0) {
    await adminDb.insert(publishedShifts).values(
      currentShifts.map((s) => ({
        scheduleId: schedule.id,
        employeeId: s.employeeId,
        workplaceId: s.workplaceId,
        date: s.date,
        shiftTemplateId: s.shiftTemplateId,
        startTime: s.startTime,
        endTime: s.endTime,
        breakMinutes: s.breakMinutes,
        crossesMidnight: s.crossesMidnight,
        publishedBy,
      })),
    );
  }
  await adminDb.update(schedules).set({ status: "published" }).where(eq(schedules.id, schedule.id));
}

export async function seedScheduleAndAttendance(ctx: SeedScheduleContext): Promise<void> {
  // --- Šablóny zmien -------------------------------------------------------
  const [hotelShift] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId: ctx.hotelId, ...HOTEL_SHIFT })
    .returning();
  const [officeShift] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId: ctx.officeId, ...OFFICE_SHIFT })
    .returning();

  // --- Pokrytie — zámerne 1 zmena/deň na pozíciu, nech je pri malom počte
  // ľudí ľahké obsadiť bez porušenia odpočinku/týždenného stropu. ---------
  await adminDb.insert(coverageRequirements).values([
    { workplaceId: ctx.hotelId, positionId: ctx.recepciaId, shiftTemplateId: hotelShift.id, minPeople: 1, weekdays: ALL_WEEKDAYS },
    { workplaceId: ctx.hotelId, positionId: ctx.chyznaId, shiftTemplateId: hotelShift.id, minPeople: 1, weekdays: WEEKDAYS_MON_FRI },
    { workplaceId: ctx.officeId, positionId: ctx.ucotvnikId, shiftTemplateId: officeShift.id, minPeople: 1, weekdays: WEEKDAYS_MON_FRI },
  ]);

  // --- História pozícií — CHÝBALA aj pre pôvodných Janu/Petra (nález L4,
  // bez nej lib/punch/attendance.ts nevie odvodiť režim prestávok). --------
  await adminDb.insert(employeePositionHistory).values([
    { employeeId: ctx.janaId, positionId: ctx.recepciaId, validFrom: "2024-01-15" },
    { employeeId: ctx.zuzanaId, positionId: ctx.recepciaId, validFrom: "2025-03-01" },
    { employeeId: ctx.katarinaId, positionId: ctx.chyznaId, validFrom: "2025-06-01" },
    { employeeId: ctx.peterId, positionId: ctx.ucotvnikId, validFrom: "2023-06-01" },
  ]);

  // --- Manažér s granulárnymi pravomocami (bez "Kontá", nech je vidno, že
  // aj čiastočné pridelenie funguje) — presne pre screenshoty L4/D++1. -----
  await adminDb.insert(managerPermissions).values({
    userId: ctx.managerHotelUserId,
    managePositionsShifts: true,
    manageRules: true,
    manageTerminals: true,
  });

  // --- Rozvrh: TENTO mesiac vygenerovaný AJ zverejnený, BUDÚCI mesiac len
  // vygenerovaný (zámerne bez publishSchedule — návrh pre screenshot
  // "kalendar-po-generovani"). ---------------------------------------------
  const { year, month } = currentYearMonth();
  const next = shiftMonth(year, month, 1);

  for (const workplaceId of [ctx.hotelId, ctx.officeId]) {
    await runGenerateAsCron(adminDb, workplaceId, year, month);
    await publishSchedule(workplaceId, year, month, ctx.ownerUserId);
    await runGenerateAsCron(adminDb, workplaceId, next.year, next.month);
  }

  // --- Pípnutia za posledných pár dní, VŠETCI zamestnanci oboch prevádzok
  // (nie len Jana/Peter — generátor si sám rozdelí zmeny medzi Janu/Zuzanu,
  // konkrétne mená vopred nevieme), vrátane jedného meškania a jedného
  // chýbajúceho odpípania odchodu. -----------------------------------------
  const schedule = await findScheduleOrThrow(ctx.hotelId, year, month);
  const officeSchedule = await findScheduleOrThrow(ctx.officeId, year, month);

  const hotelShiftRows = await adminDb.select().from(scheduledShifts).where(eq(scheduledShifts.scheduleId, schedule.id));
  const officeShiftRows = await adminDb.select().from(scheduledShifts).where(eq(scheduledShifts.scheduleId, officeSchedule.id));

  const todayDay = new Date().getDate();
  const isRecentPastShift = (dateStr: string) => {
    const day = Number(dateStr.slice(8, 10));
    return day < todayDay && day >= Math.max(1, todayDay - 6);
  };

  const hotelRecent = hotelShiftRows.filter((s) => isRecentPastShift(s.date)).sort((a, b) => a.date.localeCompare(b.date));
  const officeRecent = officeShiftRows.filter((s) => isRecentPastShift(s.date)).sort((a, b) => a.date.localeCompare(b.date));
  const allRecent = [...hotelRecent, ...officeRecent];

  const recomputeTargets: { employeeId: string; workplaceId: string; date: string }[] = [];
  // Presne JEDNO meškanie (prvá zmena v okne) a JEDNO chýbajúce odpípanie
  // odchodu (posledná zmena v okne) — zvyšok normálny príchod/odchod.
  const lateShiftId = allRecent[0]?.id;
  const missingCheckoutShiftId = allRecent.length > 1 ? allRecent[allRecent.length - 1].id : undefined;

  for (const shift of allRecent) {
    const lateMinutes = shift.id === lateShiftId ? 27 : 0;
    const arriveAt = new Date(zonedTimeToUtc(shift.date, shift.startTime).getTime() + lateMinutes * 60_000);
    const values: (typeof punchEvents.$inferInsert)[] = [
      { employeeId: shift.employeeId, workplaceId: shift.workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: arriveAt },
    ];
    if (shift.id !== missingCheckoutShiftId) {
      values.push({ employeeId: shift.employeeId, workplaceId: shift.workplaceId, direction: "out", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(shift.date, shift.endTime) });
    }
    await adminDb.insert(punchEvents).values(values);
    recomputeTargets.push({ employeeId: shift.employeeId, workplaceId: shift.workplaceId, date: shift.date });

    if (shift.id === missingCheckoutShiftId) {
      // Zodpovedajúca žiadosť "Chýba mi pípnutie" — presne to, čo by si
      // zamestnanec sám nahlásil (app/(app)/moja-dochadzka, MissingPunchCard).
      await adminDb.insert(missingPunchRequests).values({
        employeeId: shift.employeeId,
        workplaceId: shift.workplaceId,
        date: shift.date,
        direction: "out",
        kind: "zmena",
        requestedTime: zonedTimeToUtc(shift.date, shift.endTime),
        reason: "Zabudol som pípnuť odchod.",
      });
    }
  }

  for (const t of recomputeTargets) {
    await recomputeAttendanceDay(adminDb, t.employeeId, t.workplaceId, t.date);
  }

  // --- "Na prestávke práve teraz" (Prehľad dňa) — bez toho, kto má DNES
  // zmenu, appka nikoho neukáže: `/dnes` nemá žiadnu inú sekciu "kto
  // pracuje", len tento presný dopyt (`getOnBreakNow`, ktorý vyžaduje
  // `attendanceDays.status = 'working'` PRE DNEŠOK a poslednú udalosť
  // druhu 'prestavka' s `direction = 'out'`). Zmena `isRecentPastShift`
  // vyššie (`day < todayDay`) DNEŠNÝ deň zámerne vynecháva, takže bez tejto
  // sekcie by DNES nemal žiadne pípnutie vôbec. Zámerne NIE Jana — ona je
  // fixná "zamestnanec" rola pre screenshoty (`scripts/dev-accounts-photo.ts`)
  // a jej "Moja dochádzka" musí ostať nekliknutá, inak by tlačidlo
  // "Pípnuť príchod" na jej vlastnej snímke ukazovalo "Pípnuť odchod".
  const isToday = (dateStr: string) => Number(dateStr.slice(8, 10)) === todayDay;
  const todaysShift = [...hotelShiftRows, ...officeShiftRows].find((s) => isToday(s.date) && s.employeeId !== ctx.janaId);
  if (todaysShift) {
    const arriveAt = zonedTimeToUtc(todaysShift.date, todaysShift.startTime);
    // 10:30 — pred ustáleným časom screenshotov (11:00, `scripts/screenshots/config.ts`),
    // nech je "od 10:30 · 30 min" na obrázku vždy rovnaké naprieč behmi.
    const breakStartAt = zonedTimeToUtc(todaysShift.date, "10:30:00");
    await adminDb.insert(punchEvents).values([
      { employeeId: todaysShift.employeeId, workplaceId: todaysShift.workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: arriveAt },
      { employeeId: todaysShift.employeeId, workplaceId: todaysShift.workplaceId, direction: "out", method: "manual", kind: "prestavka", occurredAt: breakStartAt },
    ]);
    await recomputeAttendanceDay(adminDb, todaysShift.employeeId, todaysShift.workplaceId, todaysShift.date);
  }

  // --- Žiadosti o neprítomnosť — po jednej v každom stave. ----------------
  const todayStr = toDateStr(year, month, todayDay);
  const inDays = (n: number) => {
    const d = new Date(`${todayStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  await adminDb.insert(absenceRequests).values({
    employeeId: ctx.zuzanaId,
    workplaceId: ctx.hotelId,
    kind: "dovolenka",
    dateFrom: inDays(10),
    dateTo: inDays(12),
    reason: "Rodinná dovolenka.",
    status: "pending",
    requestedBy: ctx.managerHotelUserId,
  });

  // `absences` (materializovaný stav, čo číta generátor/výkazy) sa NEDOTÝKA
  // priamo — DB trigger `absence_requests_materialize` (migrácia 0016) ju
  // založí SÁM z riadku nižšie (aj pre "pending", aj pre "approved"), presne
  // ako pri manažérovom schválení cez UI. Manuálny insert do `absences` by
  // s ním kolidoval (ON CONFLICT (employee_id, date) DO NOTHING v trigeri).
  //
  // Fáza S (doriešenie, kolo 3) — dátum posunutý z inDays(-3..-1) na
  // bezpečne vzdialenú minulosť (mimo aktuálne zobrazovaného mesiaca).
  // Katarína je JEDINÁ Chyžná — jej PN v AKTUÁLNOM mesiaci nevyhnutne
  // spôsobí "X dní s neúplným pokrytím" (žiadny náhradník, minPeople:1),
  // bez ohľadu na to, KTORÝ presný deň v mesiaci by sa zvolil. Presunuté
  // (nie zmazané) — príklad schválenej PN žiadosti v dátach zostáva,
  // len mimo generovaného rozvrhu, rovnaký vzor ako Janina schválená
  // dovolenka nižšie.
  await adminDb.insert(absenceRequests).values({
    employeeId: ctx.katarinaId,
    workplaceId: ctx.hotelId,
    kind: "pn",
    dateFrom: inDays(-45),
    dateTo: inDays(-43),
    reason: "Chrípka.",
    status: "approved",
    requestedBy: ctx.managerHotelUserId,
    decidedBy: ctx.ownerUserId,
    decidedAt: new Date(),
  });

  await adminDb.insert(absenceRequests).values({
    employeeId: ctx.peterId,
    workplaceId: ctx.officeId,
    kind: "dovolenka",
    dateFrom: inDays(15),
    dateTo: inDays(15),
    reason: "Súkromná záležitosť.",
    status: "rejected",
    requestedBy: ctx.ownerUserId,
    decidedBy: ctx.ownerUserId,
    decidedAt: new Date(),
    decisionNote: "V tomto termíne má voľno už niekto iný z Office — skús iný dátum.",
  });

  // --- Janine žiadosti vo VŠETKÝCH troch stavoch naraz — presne pre
  // "Moje žiadosti" (README, "žiadosti vo viacerých stavoch"). Jana je
  // fixná "zamestnanec" rola pre screenshoty, takže toto je jediné miesto,
  // odkiaľ sa dá naraz ukázať pending/approved/rejected pre JEDNÉHO
  // človeka (manažérska stránka "Žiadosti" zámerne ukazuje LEN čakajúce —
  // to nie je chyba, je to fronta na rozhodnutie, nie história). Dátumy
  // zámerne ďaleko v minulosti (mimo aktuálneho aj budúceho mesiaca, ktoré
  // jediné má appka vygenerovaný rozvrh) — schválená/zamietnutá žiadosť sa
  // tak nemôže stretnúť so zmenou, ktorú Jana v kalendári už má, a
  // nespôsobí žiadne porušenie/dieru v rozvrhu.
  await adminDb.insert(absenceRequests).values({
    employeeId: ctx.janaId,
    workplaceId: ctx.hotelId,
    kind: "paragraf",
    dateFrom: inDays(6),
    dateTo: inDays(6),
    isPartialDay: true,
    hours: "2.00",
    reason: "Vyšetrenie u lekára.",
    status: "pending",
    requestedBy: ctx.managerHotelUserId,
  });

  await adminDb.insert(absenceRequests).values({
    employeeId: ctx.janaId,
    workplaceId: ctx.hotelId,
    kind: "dovolenka",
    dateFrom: inDays(-35),
    dateTo: inDays(-33),
    reason: "Predĺžený víkend.",
    status: "approved",
    requestedBy: ctx.managerHotelUserId,
    decidedBy: ctx.ownerUserId,
    decidedAt: new Date(),
  });

  await adminDb.insert(absenceRequests).values({
    employeeId: ctx.janaId,
    workplaceId: ctx.hotelId,
    kind: "nahradne_volno",
    dateFrom: inDays(-40),
    dateTo: inDays(-40),
    reason: "Náhradné voľno za odpracovaný sviatok.",
    status: "rejected",
    requestedBy: ctx.managerHotelUserId,
    decidedBy: ctx.ownerUserId,
    decidedAt: new Date(),
    decisionNote: "V tomto období chýba pokrytie na Recepcii — skús iný termín.",
  });
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/zamestnancov/dochádzku priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  absences,
  employeePositionHistory,
  employeeRateHistory,
  employeeSalaryHistory,
  employees,
  employeeWorkplaces,
  organizations,
  positions,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { buildMonthlySummary } from "./monthly-summary";

/**
 * Blok 12 — dátový základ výkazu. Doteraz overené len jednorazovým skriptom
 * na reálnej dev DB — tento súbor to zamyká ako automatický
 * regresný test, nech sa mzdový výpočet nemôže potichu pokaziť.
 */

let orgId: string;
let workplaceId: string;
let positionId: string;
let empFullId: string;
let empOutsideId: string;
let empFixedId: string;
let empFixedNoHistoryId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `Monthly summary test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia" }).returning();
  positionId = position.id;

  const [empFull] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Plná", lastName: "Mzda", personalNumber: "E001", hiredOn: "2024-01-01", vacationDaysPerYear: "20" })
    .returning();
  empFullId = empFull.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: empFullId, workplaceId });
  await adminDb.insert(employeePositionHistory).values({ employeeId: empFullId, positionId, validFrom: "2024-01-01" });

  // Sadzba rozdelená v POLOVICI mesiaca (marec 2027): 10 EUR do 14.3., 12 EUR od 15.3.
  await adminDb.insert(employeeRateHistory).values([
    { employeeId: empFullId, hourlyRate: "10.0000", validFrom: "2024-01-01", validTo: "2027-03-14" },
    { employeeId: empFullId, hourlyRate: "12.0000", validFrom: "2027-03-15", validTo: null },
  ]);

  // 2 dni PRED zmenou (10 EUR), 2 dni PO zmene (12 EUR), každý 8h odpracovaných + 1h nadčas.
  await adminDb.insert(attendanceDays).values([
    { employeeId: empFullId, workplaceId, date: "2027-03-10", workedHours: "8.000", overtimeHours: "1.000", weekendHours: "0", holidayHours: "0", nightHours: "0", status: "done" },
    { employeeId: empFullId, workplaceId, date: "2027-03-11", workedHours: "8.000", overtimeHours: "0", weekendHours: "0", holidayHours: "0", nightHours: "0", isLate: true, lateMinutes: 10, status: "done" },
    { employeeId: empFullId, workplaceId, date: "2027-03-20", workedHours: "8.000", overtimeHours: "0", weekendHours: "8.000", holidayHours: "0", nightHours: "0", status: "done" },
    { employeeId: empFullId, workplaceId, date: "2027-03-21", workedHours: "8.000", overtimeHours: "0", weekendHours: "0", holidayHours: "0", nightHours: "7.500", status: "done" },
    // Naplánovaný, ale ešte neodpracovaný deň (status 'planned') — nesmie sa počítať do daysWorked/workedHours.
    { employeeId: empFullId, workplaceId, date: "2027-03-25", workedHours: "0", overtimeHours: "0", weekendHours: "0", holidayHours: "0", nightHours: "0", status: "planned" },
  ]);

  // Dovolenka: 2 potvrdené dni V TOMTO mesiaci + 1 potvrdený deň SKÔR v roku (obe sa počítajú do "čerpané od 1.1."), 1 NEPOTVRDENÝ deň (nesmie sa počítať).
  await adminDb.insert(absences).values([
    { employeeId: empFullId, workplaceId, date: "2027-01-05", kind: "dovolenka", isConfirmed: true },
    { employeeId: empFullId, workplaceId, date: "2027-03-05", kind: "dovolenka", isConfirmed: true },
    { employeeId: empFullId, workplaceId, date: "2027-03-06", kind: "dovolenka", isConfirmed: true },
    { employeeId: empFullId, workplaceId, date: "2027-03-07", kind: "dovolenka", isConfirmed: false }, // pending — nesmie sa počítať
    { employeeId: empFullId, workplaceId, date: "2027-03-15", kind: "pn", isConfirmed: true },
  ]);

  // Zamestnanec MIMO mesiaca (nastúpil až v apríli) — nesmie sa vôbec objaviť v marcovom prehľade.
  const [empOutside] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Mimo", lastName: "Obdobia", hiredOn: "2027-04-01" })
    .returning();
  empOutsideId = empOutside.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: empOutsideId, workplaceId });

  // Fixný plat (override na zamestnancovi — pozícia zostáva "hodinovy" default,
  // rovnaký vzor ako break_tracking_mode override). Fix 800 + variabilná 150 —
  // grossWage MUSÍ byť presne 950, BEZ OHĽADU na odpracované hodiny nižšie.
  const [empFixed] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Fixný", lastName: "Plat", hiredOn: "2024-01-01", overridePayMode: "fixny" })
    .returning();
  empFixedId = empFixed.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: empFixedId, workplaceId });
  await adminDb.insert(employeePositionHistory).values({ employeeId: empFixedId, positionId, validFrom: "2024-01-01" });
  await adminDb.insert(employeeSalaryHistory).values({ employeeId: empFixedId, fixAmount: "800.00", variableAmount: "150.00", validFrom: "2024-01-01", validTo: null });
  // Hodiny sa musia naďalej evidovať (informačne vo výkaze) — 3 dni × 8h — ale nesmú vplývať na grossWage.
  await adminDb.insert(attendanceDays).values([
    { employeeId: empFixedId, workplaceId, date: "2027-03-08", workedHours: "8.000", overtimeHours: "0", weekendHours: "0", holidayHours: "0", nightHours: "0", status: "done" },
    { employeeId: empFixedId, workplaceId, date: "2027-03-09", workedHours: "8.000", overtimeHours: "0", weekendHours: "0", holidayHours: "0", nightHours: "0", status: "done" },
    { employeeId: empFixedId, workplaceId, date: "2027-03-10", workedHours: "8.000", overtimeHours: "0", weekendHours: "0", holidayHours: "0", nightHours: "0", status: "done" },
  ]);

  // Fixný plat BEZ založenej histórie — grossWage musí ticho zostať 0 (rovnako ako pri hodinovom bez sadzby), nie pád.
  const [empFixedNoHistory] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Fixný", lastName: "Bez Histórie", hiredOn: "2024-01-01", overridePayMode: "fixny" })
    .returning();
  empFixedNoHistoryId = empFixedNoHistory.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: empFixedNoHistoryId, workplaceId });
  await adminDb.insert(employeePositionHistory).values({ employeeId: empFixedNoHistoryId, positionId, validFrom: "2024-01-01" });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("buildMonthlySummary — marec 2027, Hotel", () => {
  it("zamestnanec MIMO obdobia (nastúpil neskôr) sa v prehľade vôbec nezjaví", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    expect(summary.employees.some((e) => e.employeeId === empOutsideId)).toBe(false);
  });

  it("agreguje hodiny zo VŠETKÝCH 'done' dní, vynechá 'planned' deň", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFullId)!;
    expect(e.daysWorked).toBe(4); // 5 riadkov, 1 je 'planned' → nepočíta sa
    expect(e.workedHours).toBeCloseTo(32, 6); // 4 × 8h
    expect(e.overtimeHours).toBeCloseTo(1, 6);
    expect(e.weekendHours).toBeCloseTo(8, 6);
    expect(e.nightHours).toBeCloseTo(7.5, 6);
    expect(e.lateCount).toBe(1);
    expect(e.lateMinutesTotal).toBe(10);
  });

  it("getRateAt PER DEŇ — mzda rozdelená presne na hranici zmeny sadzby (10.3./11.3. @ 10 EUR, 20.3./21.3. @ 12 EUR)", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFullId)!;
    // 10.3.: (8+1)h × 10 = 90. 11.3.: 8h × 10 = 80. 20.3.: 8h × 12 = 96. 21.3.: 8h × 12 = 96. Spolu 362.
    expect(e.grossWage).toBeCloseTo(362, 6);
  });

  it("neprítomnosti — potvrdené v TOMTO mesiaci áno, NEPOTVRDENÉ nie", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFullId)!;
    expect(e.absenceDays.dovolenka).toBe(2); // 5.3. a 6.3. potvrdené — 7.3. NEPOTVRDENÝ sa nepočíta
    expect(e.absenceDays.pn).toBe(1);
  });

  it("dovolenka nárok/čerpané/zostatok — čerpané je OD ZAČIATKU ROKA (5.1. + 5.3. + 6.3. = 3 dni), nie len tento mesiac", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFullId)!;
    expect(e.vacation.entitlement).toBe(20);
    expect(e.vacation.taken).toBeCloseTo(3, 6);
    expect(e.vacation.remaining).toBeCloseTo(17, 6);
  });

  it("totals agreguje naprieč zamestnancami", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    // 32 (Plná Mzda) + 24 (Fixný Plat, evidované aj keď mzdu neurčujú) = 56.
    expect(summary.totals.workedHours).toBeCloseTo(56, 6);
    // 362 (hodinový) + 950 (fixný) + 0 (fixný bez histórie) = 1312.
    expect(summary.totals.grossWage).toBeCloseTo(1312, 6);
    expect(summary.totals.absenceDays.dovolenka).toBe(2);
  });

  it("hodinový zamestnanec — payMode 'hodinovy' (resolvePayMode z pozície, žiadny override)", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFullId)!;
    expect(e.payMode).toBe("hodinovy");
  });

  it("fixný plat — grossWage = fix + variabilná, BEZ OHĽADU na odpracované hodiny; hodiny sú aj tak vidno", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFixedId)!;
    expect(e.payMode).toBe("fixny");
    expect(e.grossWage).toBeCloseTo(950, 6); // 800 + 150, nie z hodín
    expect(e.workedHours).toBeCloseTo(24, 6); // 3 × 8h — evidované, ale mzdu neurčujú
  });

  it("fixný plat bez založenej histórie — grossWage ticho 0 (nie pád), rovnako ako hodinový bez sadzby", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    const e = summary.employees.find((x) => x.employeeId === empFixedNoHistoryId)!;
    expect(e.payMode).toBe("fixny");
    expect(e.grossWage).toBe(0);
  });

  it("zmiešaná prevádzka (hodinový + fixný naraz) — totals.grossWage sčíta oba typy správne", async () => {
    const summary = await buildMonthlySummary(adminDb, workplaceId, 2027, 3);
    // 362 (hodinový) + 950 (fixný) + 0 (fixný bez histórie) = 1312.
    expect(summary.totals.grossWage).toBeCloseTo(1312, 6);
  });
});

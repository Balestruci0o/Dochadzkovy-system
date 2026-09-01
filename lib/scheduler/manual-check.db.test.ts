import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/prevádzku/šablóny priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { employeeAvailabilityRules, employeePositionHistory, employees, employeeWorkplaces, legalRules, organizations, positions, scheduledShifts, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { getOrCreateSchedule } from "@/app/(app)/kalendar/schedule";
import { checkManualAssignment } from "./manual-check";

/**
 * Q3 — `checkManualAssignment` musí spustiť PRESNE ten istý
 * `evaluateRules`, ktorý používa generátor, na JEDNU manuálnu zmenu z
 * kalendára — predtým `assignShiftAction` nekontrolovala vôbec nič.
 */

let orgId: string;
let ownerId: string;

async function newWorkplace() {
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  return wp.id;
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `manual-check test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@manualcheck-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerId = owner.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

const RANNA = { startTime: "07:00:00", endTime: "15:00:00", crossesMidnight: false, breakMinutes: 30 };

describe("checkManualAssignment — Q3", () => {
  it("žiadne pravidlá, žiadne existujúce zmeny → 0 porušení", async () => {
    const workplaceId = await newWorkplace();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez", lastName: "Pravidiel", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });

    const violations = await withUserContext(ownerId, (tx) => checkManualAssignment(tx, { employeeId: employee.id, workplaceId, date: "2026-09-10", shift: RANNA }));
    expect(violations).toEqual([]);
  });

  it("MIN_REST_DAILY (hard, §ZP): zmena hneď po nočnej — nájde porušenie, NIC nezapíše", async () => {
    const workplaceId = await newWorkplace();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Nočná", lastName: "Zmena", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    await adminDb.insert(legalRules).values({ orgId, code: "MIN_REST_DAILY", name: "Denný odpočinok", params: { hours: 11 }, isHard: true }).onConflictDoNothing();

    // Predošlý deň: zmena do 23:00 — ranná 07:00 nasledujúci deň = len 8h odpočinku (< 11h).
    const schedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2026, 9));
    await adminDb.insert(scheduledShifts).values({ scheduleId: schedule.id, employeeId: employee.id, workplaceId, date: "2026-09-09", startTime: "15:00:00", endTime: "23:00:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true });

    const violations = await withUserContext(ownerId, (tx) => checkManualAssignment(tx, { employeeId: employee.id, workplaceId, date: "2026-09-10", shift: RANNA }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "MIN_REST_DAILY", isHard: true });
  });

  it("ROVNAKÝ deň má UŽ existujúcu zmenu (nahrádzame ju) — jeho stará hodnota sa NEPOČÍTA do kontextu", async () => {
    const workplaceId = await newWorkplace();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Nahradenie", lastName: "Dňa", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    await adminDb.insert(legalRules).values({ orgId, code: "MIN_REST_DAILY", name: "Denný odpočinok", params: { hours: 11 }, isHard: true }).onConflictDoNothing();

    // Zajtrajšia zmena UŽ existuje (bude nahradená) — nesmie sa počítať ako "dnešný odpočinok pred zajtrajškom".
    const schedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2026, 9));
    await adminDb.insert(scheduledShifts).values({ scheduleId: schedule.id, employeeId: employee.id, workplaceId, date: "2026-09-10", startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30, crossesMidnight: false, source: "manual", locked: true });

    // Žiadna zmena 9.9. → nahradenie 10.9. rannou nemá čo porušiť.
    const violations = await withUserContext(ownerId, (tx) => checkManualAssignment(tx, { employeeId: employee.id, workplaceId, date: "2026-09-10", shift: RANNA }));
    expect(violations).toEqual([]);
  });

  it("block_length (soft): mimo bloku — nájde MÄKKÉ porušenie, nie tvrdé", async () => {
    const workplaceId = await newWorkplace();
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Mimo", lastName: "Bloku", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    await adminDb.insert(employeeAvailabilityRules).values({ employeeId: employee.id, workplaceId, ruleType: "block_length", params: { days: 5 }, isHard: false, priority: 50 });

    // Už odpracoval 5 dní v rade (8.-12.9.) — 13.9. by bol 6. deň, block_length porušenie.
    const schedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2026, 9));
    for (const date of ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12"]) {
      await adminDb.insert(scheduledShifts).values({ scheduleId: schedule.id, employeeId: employee.id, workplaceId, date, ...RANNA, source: "manual", locked: true });
    }

    const violations = await withUserContext(ownerId, (tx) => checkManualAssignment(tx, { employeeId: employee.id, workplaceId, date: "2026-09-13", shift: RANNA }));

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ code: "BLOCK_LENGTH", isHard: false });
  });

  it("nerovnomerny_turnus: MAX_WEEKLY_HOURS sa NEKONTROLUJE (rovnaké pravidlo ako v generátore)", async () => {
    const workplaceId = await newWorkplace();
    const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia turnus" }).returning();
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Turnusový", lastName: "Zamestnanec", hiredOn: "2024-01-01", workTimeMode: "nerovnomerny_turnus", balancingPeriodMonths: 4 })
      .returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });
    await adminDb.insert(employeePositionHistory).values({ employeeId: employee.id, positionId: position.id, validFrom: "2024-01-01" });
    await adminDb.insert(legalRules).values({ orgId, code: "MAX_WEEKLY_HOURS", name: "Max. týždenne", params: { hours: 40 }, isHard: true }).onConflictDoNothing();

    // Už 40h tento ISO týždeň (5×8h) — bežná ranná by mala prekročiť strop, KEBY platil.
    const schedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2026, 9));
    for (const date of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
      await adminDb.insert(scheduledShifts).values({ scheduleId: schedule.id, employeeId: employee.id, workplaceId, date, ...RANNA, source: "manual", locked: true });
    }

    const violations = await withUserContext(ownerId, (tx) => checkManualAssignment(tx, { employeeId: employee.id, workplaceId, date: "2026-09-12", shift: RANNA }));
    expect(violations.find((v) => v.code === "MAX_WEEKLY_HOURS")).toBeUndefined();
  });
});

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/prevádzku/pokrytie priamo, mimo bežného app.user_id toku (rovnaký vzor ako app/api/cron/generate-schedule/route.test.ts)
import { adminDb } from "@/lib/db/admin";
import {
  coverageRequirements,
  employeePositionHistory,
  employees,
  employeeWorkplaces,
  scheduledShifts,
  scheduleViolations,
  shiftLeaderAssignments,
  shiftTemplates,
  organizations,
  positions,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { runGenerateAsCron } from "./run-generate";

/**
 * Vedúci smeny, krok 2 — END-TO-END cez CELÝ reťazec (`loadGenerateInput` →
 * `generateSchedule` → `persistGenerateResult` → `assignShiftLeaders` →
 * `persistShiftLeaderResult`, presne ako `run-generate.ts` volá), nie len
 * jednotlivé vrstvy izolovane (tie majú vlastné testy — `shift-leader.test.ts`,
 * `shift-leader-writer.test.ts`). Overuje dve veci, čo izolované testy
 * NEDOKÁŽU: (1) že `db-loader.ts` naozaj vytiahne `can_be_shift_leader`/
 * `requires_shift_leader` zo skutočných tabuliek, (2) že vedúci JE jeden z
 * priradených — počet priradených ľudí (scheduled_shifts) sa vôbec nezmení
 * podľa toho, či pozícia vyžaduje vedúceho alebo nie.
 */

let orgId: string;
let workplaceId: string;
let positionId: string;
let eligibleEmployeeId: string;
let ineligibleEmployeeId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `shift-leader e2e test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;

  const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia", requiresShiftLeader: true }).returning();
  positionId = position.id;

  const [template] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId, name: "Denná 8h", code: `D8-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 })
    .returning();

  // minPeople=2 — DVAJA ľudia na deň, len JEDEN z nich smie byť vedúci (can_be_shift_leader).
  await adminDb.insert(coverageRequirements).values({
    workplaceId,
    positionId,
    shiftTemplateId: template.id,
    minPeople: 2,
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    appliesHolidays: true,
    isHard: true,
  });

  const [eligible] = await adminDb.insert(employees).values({ orgId, firstName: "Oprávnená", lastName: "Vedúca", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
  const [ineligible] = await adminDb.insert(employees).values({ orgId, firstName: "Neoprávnený", lastName: "Zamestnanec", hiredOn: "2024-01-01", canBeShiftLeader: false }).returning();
  eligibleEmployeeId = eligible.id;
  ineligibleEmployeeId = ineligible.id;

  for (const emp of [eligible, ineligible]) {
    await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.id, workplaceId });
    await adminDb.insert(employeePositionHistory).values({ employeeId: emp.id, positionId, validFrom: "2024-01-01" });
  }
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("Vedúci smeny, krok 2 — end-to-end cez runGenerateAsCron", () => {
  it("vedúci JE jeden z priradených (počet ľudí na smene sa nezmení) a je to práve ten oprávnený", async () => {
    const report = await adminDb.transaction((tx) => runGenerateAsCron(tx, workplaceId, 2028, 6));
    expect(report.shiftsCreated).toBeGreaterThan(0);

    const shifts = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.workplaceId, workplaceId), eq(scheduledShifts.source, "generated")));
    // minPeople=2, žiadna diera očakávaná (2 zamestnanci, obaja bez obmedzení) — presne 2 na každý deň, čo generátor obsadil.
    const daysAssigned = new Set(shifts.map((s) => s.date)).size;
    expect(shifts.length).toBe(daysAssigned * 2);

    const leaderRows = await adminDb.select().from(shiftLeaderAssignments).where(eq(shiftLeaderAssignments.workplaceId, workplaceId));
    expect(leaderRows.length).toBeGreaterThan(0);
    // KAŽDÝ deň s vedúcim MUSÍ byť deň, kde OBAJA (2) ľudia reálne pracovali — vedúci nikdy nie je "navyše".
    for (const leaderRow of leaderRows) {
      expect(leaderRow.employeeId).toBe(eligibleEmployeeId); // jediný oprávnený kandidát
      const shiftsThatDay = shifts.filter((s) => s.date === leaderRow.date);
      const employeeIdsThatDay = shiftsThatDay.map((s) => s.employeeId);
      expect(employeeIdsThatDay).toContain(leaderRow.employeeId); // vedúci je MEDZI priradenými, nie navyše
      expect(employeeIdsThatDay).toHaveLength(2); // headcount nezmenený
    }

    // Neoprávnený zamestnanec sa NIKDY nestal vedúcim, aj keď pracoval rovnaké dni.
    expect(leaderRows.every((r) => r.employeeId !== ineligibleEmployeeId)).toBe(true);

    // Žiadna diera vedúceho — obaja zamestnanci pracujú, jeden je vždy oprávnený.
    const gapViolations = await adminDb.select().from(scheduleViolations).where(and(eq(scheduleViolations.positionId, positionId), eq(scheduleViolations.ruleCode, "NO_SHIFT_LEADER")));
    expect(gapViolations).toHaveLength(0);
  });
});

describe("Vedúci smeny, krok 2 — NIKTO oprávnený nepracuje na pozícii, čo vedúceho vyžaduje", () => {
  let noLeaderOrgId: string;
  let noLeaderWorkplaceId: string;
  let noLeaderPositionId: string;

  beforeAll(async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `shift-leader e2e no-leader org ${crypto.randomUUID()}` }).returning();
    noLeaderOrgId = org.id;
    const [wp] = await adminDb.insert(workplaces).values({ orgId: noLeaderOrgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    noLeaderWorkplaceId = wp.id;

    const [position] = await adminDb.insert(positions).values({ orgId: noLeaderOrgId, workplaceId: noLeaderWorkplaceId, name: "Recepcia", requiresShiftLeader: true }).returning();
    noLeaderPositionId = position.id;

    const [template] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId: noLeaderWorkplaceId, name: "Denná 8h", code: `D8-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 })
      .returning();
    await adminDb.insert(coverageRequirements).values({
      workplaceId: noLeaderWorkplaceId,
      positionId: noLeaderPositionId,
      shiftTemplateId: template.id,
      minPeople: 1,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      appliesHolidays: true,
      isHard: true,
    });

    // Zámerne BEZ can_be_shift_leader=true — nikto oprávnený.
    const [emp] = await adminDb.insert(employees).values({ orgId: noLeaderOrgId, firstName: "Brigádnik", lastName: "Bez", hiredOn: "2024-01-01", canBeShiftLeader: false }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.id, workplaceId: noLeaderWorkplaceId });
    await adminDb.insert(employeePositionHistory).values({ employeeId: emp.id, positionId: noLeaderPositionId, validFrom: "2024-01-01" });
  });

  afterAll(async () => {
    await deleteOrgCascade(noLeaderOrgId);
  });

  it("generátor NESPADNE ani sa nezacyklí — pokrytie je normálne obsadené, žiadny shift_leader_assignments riadok, SOFT diera v schedule_violations", async () => {
    await expect(adminDb.transaction((tx) => runGenerateAsCron(tx, noLeaderWorkplaceId, 2028, 7))).resolves.toBeDefined();

    const shifts = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.workplaceId, noLeaderWorkplaceId), eq(scheduledShifts.source, "generated")));
    expect(shifts.length).toBeGreaterThan(0); // pokrytie samotné NIE JE dierou vedúceho dotknuté

    const leaderRows = await adminDb.select().from(shiftLeaderAssignments).where(eq(shiftLeaderAssignments.workplaceId, noLeaderWorkplaceId));
    expect(leaderRows).toHaveLength(0); // nikto oprávnený → žiadne rozhodnutie, nie náhodný/nesprávny vedúci

    const gapViolations = await adminDb
      .select()
      .from(scheduleViolations)
      .where(and(eq(scheduleViolations.positionId, noLeaderPositionId), eq(scheduleViolations.ruleCode, "NO_SHIFT_LEADER")));
    expect(gapViolations.length).toBe(shifts.length); // presne jedna diera za KAŽDÝ obsadený deň
    for (const v of gapViolations) {
      expect(v.severity).toBe("soft_violation"); // SOFT — nie hard_violation, nie gap (coverage samotné je OK)
      expect(v.message).toMatch(/nikto z priradených/i);
    }
  });
});

describe("Vedúci smeny, krok 6 — REGENERÁCIA rešpektuje ručne nastavené dni ako 'pravdu o dni', nikdy do nich nezapíše", () => {
  let orgId2: string;
  let workplaceId2: string;
  let positionId2: string;
  let employeeAId: string;
  let employeeBId: string;

  beforeAll(async () => {
    const [org] = await adminDb.insert(organizations).values({ name: `shift-leader e2e regen org ${crypto.randomUUID()}` }).returning();
    orgId2 = org.id;
    const [wp] = await adminDb.insert(workplaces).values({ orgId: orgId2, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    workplaceId2 = wp.id;

    const [position] = await adminDb.insert(positions).values({ orgId: orgId2, workplaceId: workplaceId2, name: "Recepcia", requiresShiftLeader: true }).returning();
    positionId2 = position.id;

    const [template] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId: workplaceId2, name: "Denná 8h", code: `D8-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 })
      .returning();
    // minPeople=2 — OBAJA pracujú KAŽDÝ deň (žiadne prirodzené prerušenie kontinuity).
    await adminDb.insert(coverageRequirements).values({
      workplaceId: workplaceId2,
      positionId: positionId2,
      shiftTemplateId: template.id,
      minPeople: 2,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      appliesHolidays: true,
      isHard: true,
    });

    const [a] = await adminDb.insert(employees).values({ orgId: orgId2, firstName: "Alena", lastName: "A", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
    const [b] = await adminDb.insert(employees).values({ orgId: orgId2, firstName: "Branislav", lastName: "B", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
    employeeAId = a.id;
    employeeBId = b.id;
    for (const emp of [a, b]) {
      await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.id, workplaceId: workplaceId2 });
      await adminDb.insert(employeePositionHistory).values({ employeeId: emp.id, positionId: positionId2, validFrom: "2024-01-01" });
    }
  });

  afterAll(async () => {
    await deleteOrgCascade(orgId2);
  });

  it("ručne prepísaný deň V STREDE mesiaca ostane po regenerácii PRESNE nedotknutý, okolité generated dni sa prepočítajú a kontinuita naň nadviaže", async () => {
    // 1. beh — obaja pracujú KAŽDÝ deň, žiadny prirodzený dôvod na zmenu vedúceho → jeden z nich vedie CELÝ mesiac (sticky).
    await adminDb.transaction((tx) => runGenerateAsCron(tx, workplaceId2, 2028, 9));

    const before = await adminDb.select().from(shiftLeaderAssignments).where(eq(shiftLeaderAssignments.workplaceId, workplaceId2));
    const naturalLeaderId = before[0].employeeId!;
    const overrideTargetId = naturalLeaderId === employeeAId ? employeeBId : employeeAId;
    expect(before.every((r) => r.employeeId === naturalLeaderId)).toBe(true); // sanity — bez zásahu vedie ten istý celý mesiac

    // 2. Manažér RUČNE prepíše 15. deň na TOHO DRUHÉHO (priamo v DB — testuje sa regenerácia, nie samotná akcia, tá má vlastné testy).
    const MANUAL_DATE = "2028-09-15";
    const decidedAt = new Date("2028-09-14T10:00:00Z");
    const [manualRow] = await adminDb
      .insert(shiftLeaderAssignments)
      .values({
        scheduleId: before[0].scheduleId,
        workplaceId: workplaceId2,
        positionId: positionId2,
        date: MANUAL_DATE,
        employeeId: overrideTargetId,
        source: "manual",
        decidedBy: null,
        decidedAt,
        note: "Ručný test override",
      })
      .onConflictDoUpdate({
        target: [shiftLeaderAssignments.workplaceId, shiftLeaderAssignments.positionId, shiftLeaderAssignments.date],
        set: { employeeId: overrideTargetId, source: "manual", decidedAt, note: "Ručný test override" },
      })
      .returning();

    // 3. REGENERÁCIA — druhý beh, ten istý mesiac.
    await adminDb.transaction((tx) => runGenerateAsCron(tx, workplaceId2, 2028, 9));

    // A) Manuálny riadok je PRESNE nedotknutý — rovnaké id, employeeId, source, decidedAt, note (nie nový, nie prepísaný).
    const [manualAfter] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.workplaceId, workplaceId2), eq(shiftLeaderAssignments.date, MANUAL_DATE)));
    expect(manualAfter.id).toBe(manualRow.id);
    expect(manualAfter.employeeId).toBe(overrideTargetId);
    expect(manualAfter.source).toBe("manual");
    expect(manualAfter.decidedAt?.getTime()).toBe(decidedAt.getTime());
    expect(manualAfter.note).toBe("Ručný test override");

    // B) Dni PRED manuálnym dňom — nezmenené, prirodzený vedúci ako predtým.
    const dayBefore = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.workplaceId, workplaceId2), eq(shiftLeaderAssignments.date, "2028-09-10")));
    expect(dayBefore[0]).toMatchObject({ employeeId: naturalLeaderId, source: "generated" });

    // C) KĽÚČOVÉ — deň HNEĎ PO manuálnom dni pokračuje ten, čo bol manuálne nastavený (kontinuita cez manuálny deň), NIE pôvodný prirodzený vedúci.
    const dayAfter = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.workplaceId, workplaceId2), eq(shiftLeaderAssignments.date, "2028-09-16")));
    expect(dayAfter[0]).toMatchObject({ employeeId: overrideTargetId, source: "generated" });
    const twoDaysAfter = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.workplaceId, workplaceId2), eq(shiftLeaderAssignments.date, "2028-09-17")));
    expect(twoDaysAfter[0]).toMatchObject({ employeeId: overrideTargetId, source: "generated" });

    // D) Headcount nezmenené na žiadny deň — vedúci (manuálny AJ generovaný) je vždy MEDZI dvoma reálne priradenými, nikdy navyše.
    const shiftsAround = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.workplaceId, workplaceId2), eq(scheduledShifts.source, "generated")));
    for (const date of ["2028-09-10", "2028-09-15", "2028-09-16"]) {
      expect(shiftsAround.filter((s) => s.date === date)).toHaveLength(2);
    }
  });
});

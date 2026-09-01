import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/zamestnancov/pozíciu priamo, mimo bežného app.user_id toku (rovnaký vzor ako db-writer.test.ts)
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { employees, organizations, positions, scheduleViolations, shiftLeaderAssignments, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { getOrCreateSchedule } from "@/app/(app)/kalendar/schedule";
import type { AssignShiftLeadersResult } from "./shift-leader";
import { persistShiftLeaderResult } from "./shift-leader-writer";

/**
 * Vedúci smeny, krok 2 — `persistShiftLeaderResult` zapisuje
 * `AssignShiftLeadersResult` (čistá funkcia `assignShiftLeaders`) do DB.
 * Testuje sa TU priamo so syntetickým výsledkom (rovnaký vzor ako
 * `db-writer.test.ts`) — cieľom je SAMOTNÁ zapisovacia vrstva: `source =
 * 'generated'`, diery → `schedule_violations` (`soft_violation`,
 * `NO_SHIFT_LEADER`), a REGENEROVANIE: `source = 'manual'` (krok 5, ešte
 * nepoužité, ale zámerne otestované vopred) sa NIKDY neprepíše.
 */

let orgId: string;
let workplaceId: string;
let ownerId: string;
let positionId: string;
let employee1Id: string;
let employee2Id: string;

const DATE_A = "2027-05-10";
const DATE_B = "2027-05-11";

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `shift-leader-writer test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@shiftleaderwriter-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerId = owner.id;

  const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia", requiresShiftLeader: true }).returning();
  positionId = position.id;

  const [emp1] = await adminDb.insert(employees).values({ orgId, firstName: "Prvá", lastName: "Vedúca", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
  const [emp2] = await adminDb.insert(employees).values({ orgId, firstName: "Druhý", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
  employee1Id = emp1.id;
  employee2Id = emp2.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("persistShiftLeaderResult", () => {
  it("zapíše rozhodnutie ako source='generated', dieru zapíše do schedule_violations (soft_violation, NO_SHIFT_LEADER)", async () => {
    const result: AssignShiftLeadersResult = {
      decisions: [{ positionId, date: DATE_A, employeeId: employee1Id }],
      gaps: [{ positionId, date: DATE_B, message: `Nikto z priradených (${employee2Id}) nemá "môže byť vedúci".` }],
    };

    const summary = await withUserContext(ownerId, (tx) => persistShiftLeaderResult(tx, workplaceId, 2027, 5, result));
    expect(summary.leadersAssigned).toBe(1);
    expect(summary.leaderGapsRecorded).toBe(1);

    const [row] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE_A)));
    expect(row).toMatchObject({ employeeId: employee1Id, workplaceId, source: "generated" });
    expect(row.decidedAt).not.toBeNull();

    const violations = await adminDb.select().from(scheduleViolations).where(and(eq(scheduleViolations.positionId, positionId), eq(scheduleViolations.date, DATE_B)));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ severity: "soft_violation", ruleCode: "NO_SHIFT_LEADER", ruleSource: "generator" });
  });

  it("regenerácia: 'generated' rozhodnutie sa AKTUALIZUJE (nie duplicitný riadok), 'manual' riadok sa NIKDY neprepíše", async () => {
    // Ručne nastavený vedúci (simuluje krok 5) na INÝ deň v TEJ istej pozícii — writer ho nesmie zmazať ani prepísať.
    const schedule = await withUserContext(ownerId, (tx) => getOrCreateSchedule(tx, workplaceId, 2027, 5));
    const manualDate = "2027-05-15";
    await adminDb.insert(shiftLeaderAssignments).values({
      scheduleId: schedule.id,
      workplaceId,
      positionId,
      date: manualDate,
      employeeId: employee2Id,
      source: "manual",
      decidedBy: ownerId,
      decidedAt: new Date(),
    });

    // Druhý beh: DATE_A dostane INÉHO vedúceho (employee2), DATE_B (predtým diera) teraz má vedúceho.
    const result: AssignShiftLeadersResult = {
      decisions: [
        { positionId, date: DATE_A, employeeId: employee2Id },
        { positionId, date: DATE_B, employeeId: employee1Id },
      ],
      gaps: [],
    };
    const summary = await withUserContext(ownerId, (tx) => persistShiftLeaderResult(tx, workplaceId, 2027, 5, result));
    expect(summary.leadersAssigned).toBe(2);
    expect(summary.leaderGapsRecorded).toBe(0);

    // DATE_A je AKTUALIZOVANÝ (nie duplicitný riadok, teraz employee2).
    const rowsForDateA = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE_A)));
    expect(rowsForDateA).toHaveLength(1);
    expect(rowsForDateA[0]).toMatchObject({ employeeId: employee2Id, source: "generated" });

    // DATE_B teraz má vedúceho (predtým bola diera).
    const [rowForDateB] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE_B)));
    expect(rowForDateB).toMatchObject({ employeeId: employee1Id, source: "generated" });

    // 'manual' riadok OSTÁVA PRESNE nedotknutý — nie prepísaný na 'generated', nie zmazaný.
    const [manualRow] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, manualDate)));
    expect(manualRow).toMatchObject({ employeeId: employee2Id, source: "manual", decidedBy: ownerId });
  });
});

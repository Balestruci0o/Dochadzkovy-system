import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako assign-override.test.ts)
import { adminDb } from "@/lib/db/admin";
import {
  employeePositionHistory,
  employees,
  organizations,
  positions,
  scheduledShifts,
  scheduleViolations,
  shiftLeaderAssignments,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { assignShiftLeaderAction } from "./actions";

/**
 * Vedúci smeny, krok 5 — ručný prepis. Zrkadlí presne vzor
 * `assign-override.test.ts` (Q3 "obsaď aj tak, len upozorni"),
 * len pre `shift_leader_assignments` namiesto `scheduled_shifts`.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let orgId: string;
let workplaceId: string;
let ownerAuthUserId: string;
let positionId: string;
let eligibleEmployeeId: string;
let ineligibleEmployeeId: string;
let notScheduledEmployeeId: string;
let wrongPositionEmployeeId: string;

const DATE = "2027-06-10";

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `shift-leader-assign test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  ownerAuthUserId = crypto.randomUUID();
  await adminDb.insert(users).values({ orgId, authUserId: ownerAuthUserId, email: `owner-${crypto.randomUUID()}@shiftleaderassign-test.local`, role: "owner", fullName: "Test Majiteľ" });

  const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia", requiresShiftLeader: true }).returning();
  positionId = position.id;
  const [otherPosition] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Kuchyňa" }).returning();

  const [eligible] = await adminDb.insert(employees).values({ orgId, firstName: "Oprávnená", lastName: "Vedúca", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
  const [ineligible] = await adminDb.insert(employees).values({ orgId, firstName: "Neoprávnený", lastName: "Zamestnanec", hiredOn: "2024-01-01", canBeShiftLeader: false }).returning();
  const [notScheduled] = await adminDb.insert(employees).values({ orgId, firstName: "Nepriradená", lastName: "Osoba", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
  const [wrongPosition] = await adminDb.insert(employees).values({ orgId, firstName: "Kuchár", lastName: "Iný", hiredOn: "2024-01-01", canBeShiftLeader: true }).returning();
  eligibleEmployeeId = eligible.id;
  ineligibleEmployeeId = ineligible.id;
  notScheduledEmployeeId = notScheduled.id;
  wrongPositionEmployeeId = wrongPosition.id;

  await adminDb.insert(employeePositionHistory).values([
    { employeeId: eligible.id, positionId, validFrom: "2024-01-01" },
    { employeeId: ineligible.id, positionId, validFrom: "2024-01-01" },
    { employeeId: wrongPosition.id, positionId: otherPosition.id, validFrom: "2024-01-01" },
    // notScheduled zámerne BEZ pozície aj bez zmeny.
  ]);

  const { schedules } = await import("@/lib/db/schema");
  const [schedule] = await adminDb.insert(schedules).values({ workplaceId, year: 2027, month: 6, status: "draft" }).returning();

  // eligible aj ineligible aj wrongPosition SÚ v ten deň reálne priradení na Recepcii/Kuchyni (scheduled_shifts).
  await adminDb.insert(scheduledShifts).values([
    { scheduleId: schedule.id, employeeId: eligible.id, workplaceId, date: DATE, startTime: "09:00:00", endTime: "17:00:00", breakMinutes: 30, source: "generated" },
    { scheduleId: schedule.id, employeeId: ineligible.id, workplaceId, date: DATE, startTime: "09:00:00", endTime: "17:00:00", breakMinutes: 30, source: "generated" },
    { scheduleId: schedule.id, employeeId: wrongPosition.id, workplaceId, date: DATE, startTime: "09:00:00", endTime: "17:00:00", breakMinutes: 30, source: "generated" },
  ]);
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("assignShiftLeaderAction — cieľ MUSÍ byť v ten deň na tej pozícii reálne priradený (tvrdá chyba, nedá sa obísť)", () => {
  it("zamestnanec BEZ priradenej zmeny v ten deň → chyba, nič sa nezapíše", async () => {
    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftLeaderAction({}, form({ workplaceId, positionId, date: DATE, employeeId: notScheduledEmployeeId }));
    authState.authUserId = null;

    expect(result.error).toMatch(/nemá.*priradenú zmenu/i);
    const [row] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE)));
    expect(row).toBeUndefined();
  });

  it("zamestnanec priradený, ale na INEJ pozícii → chyba, nič sa nezapíše", async () => {
    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftLeaderAction({}, form({ workplaceId, positionId, date: DATE, employeeId: wrongPositionEmployeeId }));
    authState.authUserId = null;

    expect(result.error).toMatch(/nie je na pozícii/i);
    const [row] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE)));
    expect(row).toBeUndefined();
  });
});

describe("assignShiftLeaderAction — neoprávnený (bez can_be_shift_leader): upozornenie + 'AJ TAK'", () => {
  it("bez confirmOverride: nič sa nezapíše, vráti sa upozornenie (nie tvrdá chyba)", async () => {
    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftLeaderAction({}, form({ workplaceId, positionId, date: DATE, employeeId: ineligibleEmployeeId }));
    authState.authUserId = null;

    expect(result.error).toBeUndefined();
    expect(result.violations).toHaveLength(1);
    expect(result.violations?.[0]).toMatchObject({ code: "NOT_ELIGIBLE", isHard: false });

    const [row] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE)));
    expect(row).toBeUndefined();
  });

  it("s confirmOverride=true: zapíše AJ TAK, source='manual', decidedBy nastavený", async () => {
    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftLeaderAction({}, form({ workplaceId, positionId, date: DATE, employeeId: ineligibleEmployeeId, confirmOverride: "true" }));
    authState.authUserId = null;

    expect(result.success).toBe(true);
    const [row] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE)));
    expect(row).toMatchObject({ employeeId: ineligibleEmployeeId, source: "manual" });
    expect(row.decidedBy).not.toBeNull();
    expect(row.decidedAt).not.toBeNull();
  });
});

describe("assignShiftLeaderAction — bežný prípad (oprávnený, reálne priradený)", () => {
  it("zapíše rovno bez potreby potvrdenia, prepíše predošlé rozhodnutie na ten istý deň/pozíciu", async () => {
    // Nadväzuje na predošlý blok — na DATE/positionId už existuje riadok (ineligible, z predošlého testu). Toto ho MUSÍ nahradiť, nie duplikovať.
    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftLeaderAction({}, form({ workplaceId, positionId, date: DATE, employeeId: eligibleEmployeeId, note: "Skúsená, preberá zmenu." }));
    authState.authUserId = null;

    expect(result.success).toBe(true);
    expect(result.violations).toBeUndefined();

    const rows = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, DATE)));
    expect(rows).toHaveLength(1); // AKTUALIZOVANÝ, nie duplicitný riadok
    expect(rows[0]).toMatchObject({ employeeId: eligibleEmployeeId, source: "manual", note: "Skúsená, preberá zmenu." });
  });
});

describe("assignShiftLeaderAction — 'žiadny vedúci' je VEDOMÁ voľba, odlíšená od diery generátora", () => {
  it("prázdny employeeId → zapíše employee_id=null, source='manual' — NIE schedule_violations", async () => {
    const noLeaderDate = "2027-06-11";

    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftLeaderAction({}, form({ workplaceId, positionId, date: noLeaderDate }));
    authState.authUserId = null;

    expect(result.success).toBe(true);
    const [row] = await adminDb.select().from(shiftLeaderAssignments).where(and(eq(shiftLeaderAssignments.positionId, positionId), eq(shiftLeaderAssignments.date, noLeaderDate)));
    expect(row).toMatchObject({ employeeId: null, source: "manual" });
    expect(row.decidedBy).not.toBeNull();

    // KĽÚČOVÉ — toto NIE JE diera generátora: žiadny NO_SHIFT_LEADER (ani iný) záznam v schedule_violations pre tento deň/pozíciu.
    const violations = await adminDb.select().from(scheduleViolations).where(and(eq(scheduleViolations.positionId, positionId), eq(scheduleViolations.date, noLeaderDate)));
    expect(violations).toEqual([]);
  });
});

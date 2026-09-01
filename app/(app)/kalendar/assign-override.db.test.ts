import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { employees, legalRules, notifications, organizations, scheduledShifts, scheduleViolations, shiftTemplates, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { assignShiftAction } from "./actions";

/**
 * Q3 — "obsaď aj tak, len upozorni". Predtým `assignShiftAction`
 * zapisovala VŽDY, bez ohľadu na pravidlá. Teraz: prvý pokus (bez
 * `confirmOverride`) pri porušení NIČ nezapíše, vráti porušenia; druhý pokus
 * (`confirmOverride=true`) zapíše A ZÁROVEŇ zaloguje porušenie do
 * `schedule_violations` (`ruleSource: "manual_override"`) — nech to
 * nezmizne potichu.
 *
 * Retest (E4, séria A-D + integrácia): override sa doteraz zapisoval LEN do
 * `schedule_violations` — nikto sa o tom inak nedozvedel než ručným
 * prezretím kalendára. Doplnené `notifyManualOverrideApplied` (Blok 11
 * vzor) — manažéri + owner prevádzky dostanú notifikáciu presne v momente
 * potvrdenia override.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let orgId: string;
let workplaceId: string;
let ownerAuthUserId: string;
let ownerUserId: string;
let shiftTemplateId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `assign-override test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  ownerAuthUserId = crypto.randomUUID();
  const [ownerUser] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: ownerAuthUserId, email: `owner-${crypto.randomUUID()}@override-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerUserId = ownerUser.id;

  const [template] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId, name: "Ranná", code: `R-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00", crossesMidnight: false, breakMinutes: 30 })
    .returning();
  shiftTemplateId = template.id;

  await adminDb.insert(legalRules).values({ orgId, code: "MIN_REST_DAILY", name: "Denný odpočinok", params: { hours: 11 }, isHard: true }).onConflictDoNothing();
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("assignShiftAction — Q3: obsaď aj tak, len upozorni", () => {
  it("porušenie BEZ confirmOverride: nič sa nezapíše, vráti sa presné porušenie", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Prvý", lastName: "Pokus", hiredOn: "2024-01-01" }).returning();

    // Včera do 23:00 — dnešná ranná 07:00 by dala len 8h odpočinku (< 11h MIN_REST_DAILY).
    await adminDb.insert(scheduledShifts).values({
      scheduleId: (await getOrCreateScheduleDirect(workplaceId, 2026, 9)),
      employeeId: employee.id,
      workplaceId,
      date: "2026-09-09",
      startTime: "15:00:00",
      endTime: "23:00:00",
      breakMinutes: 30,
      crossesMidnight: false,
      source: "manual",
      locked: true,
    });

    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftAction({}, form({ employeeId: employee.id, workplaceId, date: "2026-09-10", shiftTemplateId }));
    authState.authUserId = null;

    expect(result.success).toBeUndefined();
    expect(result.violations).toHaveLength(1);
    expect(result.violations?.[0]).toMatchObject({ code: "MIN_REST_DAILY", isHard: true });

    const [shift] = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.employeeId, employee.id), eq(scheduledShifts.date, "2026-09-10")));
    expect(shift).toBeUndefined();
  });

  it("porušenie S confirmOverride=true: zapíše zmenu A zaloguje schedule_violations (ruleSource=manual_override)", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Druhý", lastName: "Pokus", hiredOn: "2024-01-01" }).returning();

    await adminDb.insert(scheduledShifts).values({
      scheduleId: await getOrCreateScheduleDirect(workplaceId, 2026, 9),
      employeeId: employee.id,
      workplaceId,
      date: "2026-09-09",
      startTime: "15:00:00",
      endTime: "23:00:00",
      breakMinutes: 30,
      crossesMidnight: false,
      source: "manual",
      locked: true,
    });

    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftAction({}, form({ employeeId: employee.id, workplaceId, date: "2026-09-10", shiftTemplateId, confirmOverride: "true" }));
    authState.authUserId = null;

    expect(result.success).toBe(true);

    const [shift] = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.employeeId, employee.id), eq(scheduledShifts.date, "2026-09-10")));
    expect(shift).toMatchObject({ locked: true, source: "manual", startTime: "07:00:00", endTime: "15:00:00" });

    const violations = await adminDb.select().from(scheduleViolations).where(and(eq(scheduleViolations.employeeId, employee.id), eq(scheduleViolations.date, "2026-09-10")));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ ruleCode: "MIN_REST_DAILY", ruleSource: "manual_override", severity: "hard_violation", resolved: false });

    const notifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, ownerUserId), eq(notifications.kind, "manual_override_applied")));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].body).toContain("Test Majiteľ");
    expect(notifs[0].body).toContain("Druhý Pokus");
    expect(notifs[0].link).toBe("/kalendar");
  });

  it("BEZ porušenia: zapíše rovno, žiadny schedule_violations riadok sa nevytvorí", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Čistý", lastName: "Prípad", hiredOn: "2024-01-01" }).returning();

    authState.authUserId = ownerAuthUserId;
    const result = await assignShiftAction({}, form({ employeeId: employee.id, workplaceId, date: "2026-09-15", shiftTemplateId }));
    authState.authUserId = null;

    expect(result.success).toBe(true);
    expect(result.violations).toBeUndefined();

    const [shift] = await adminDb.select().from(scheduledShifts).where(and(eq(scheduledShifts.employeeId, employee.id), eq(scheduledShifts.date, "2026-09-15")));
    expect(shift).toMatchObject({ locked: true, source: "manual" });

    const violations = await adminDb.select().from(scheduleViolations).where(and(eq(scheduleViolations.employeeId, employee.id), eq(scheduleViolations.date, "2026-09-15")));
    expect(violations).toEqual([]);

    const notifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, ownerUserId), eq(notifications.kind, "manual_override_applied")));
    expect(notifs.some((n) => n.body?.includes("Čistý Prípad"))).toBe(false); // bez porušenia sa notifikácia neposiela — nie je čo hlásiť
  });
});

// `getOrCreateSchedule` vyžaduje Drizzle `Db` (tx pod RLS) — v testovacom
// fixtúre bez prihláseného app.user_id staviame schedule priamo cez adminDb,
// nech test-setup nezávisí od `withUserContext`/rolí, ktoré sem netreba.
async function getOrCreateScheduleDirect(workplaceId: string, year: number, month: number): Promise<string> {
  const { schedules } = await import("@/lib/db/schema");
  const existing = await adminDb.select().from(schedules).where(and(eq(schedules.workplaceId, workplaceId), eq(schedules.year, year), eq(schedules.month, month)));
  if (existing[0]) return existing[0].id;
  const [created] = await adminDb.insert(schedules).values({ workplaceId, year, month, status: "draft" }).returning();
  return created.id;
}

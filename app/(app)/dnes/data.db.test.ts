import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/auth/session";
import { DEFAULT_MANAGER_PERMISSIONS } from "@/lib/auth/manager-permissions";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, organizations, punchEvents, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { todayStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { getOnBreakNow } from "./data";

/**
 * "Na prestávke práve teraz" — priamy fixture user (žiadny `next/headers`
 * mock potrebný, `getOnBreakNow(user)` berie `CurrentUser` ako parameter,
 * nie internou `requireRole()` — rovnaký vzor ako `lib/reports/monthly-summary.test.ts`).
 */

let orgId: string;
let workplaceId: string;
let owner: CurrentUser;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `On-break-now test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [ownerUser] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@on-break-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  owner = { id: ownerUser.id, authUserId: ownerUser.authUserId!, orgId, role: "owner", fullName: ownerUser.fullName, email: ownerUser.email!, permissions: { ...DEFAULT_MANAGER_PERMISSIONS } };
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("getOnBreakNow", () => {
  it("zamestnanec, čo odišiel na prestávku a NEVRÁTIL sa, sa objaví v zozname s časom odchodu", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Na", lastName: "Prestávke", hiredOn: "2024-01-01" }).returning();
    const today = todayStr();
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(today, "09:00:00") });
    const breakStart = zonedTimeToUtc(today, "12:00:00");
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "prestavka", occurredAt: breakStart });
    await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date: today, status: "working", actualStart: zonedTimeToUtc(today, "09:00:00") });

    const result = await getOnBreakNow(owner);
    const row = result.find((r) => r.employeeId === employee.id);
    expect(row).toBeTruthy();
    expect(row!.breakStartedAt.getTime()).toBe(breakStart.getTime());
  });

  it("zamestnanec, čo sa Z prestávky UŽ VRÁTIL, sa v zozname NEOBJAVÍ", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Vrátený", lastName: "Z prestávky", hiredOn: "2024-01-01" }).returning();
    const today = todayStr();
    await adminDb.insert(punchEvents).values([
      { employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(today, "09:00:00") },
      { employeeId: employee.id, workplaceId, direction: "out", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(today, "12:00:00") },
      { employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "prestavka", occurredAt: zonedTimeToUtc(today, "12:30:00") },
    ]);
    await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date: today, status: "working", actualStart: zonedTimeToUtc(today, "09:00:00") });

    const result = await getOnBreakNow(owner);
    expect(result.some((r) => r.employeeId === employee.id)).toBe(false);
  });

  it("bežne pracujúci zamestnanec BEZ akejkoľvek prestávky sa v zozname neobjaví", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez", lastName: "Prestávky", hiredOn: "2024-01-01" }).returning();
    const today = todayStr();
    await adminDb.insert(punchEvents).values({ employeeId: employee.id, workplaceId, direction: "in", method: "manual", kind: "zmena", occurredAt: zonedTimeToUtc(today, "09:00:00") });
    await adminDb.insert(attendanceDays).values({ employeeId: employee.id, workplaceId, date: today, status: "working", actualStart: zonedTimeToUtc(today, "09:00:00") });

    const result = await getOnBreakNow(owner);
    expect(result.some((r) => r.employeeId === employee.id)).toBe(false);
  });

  afterAll(async () => {
    // attendance_days NIE JE append-only — upratanie 'working' riadkov tohto bloku (rovnaký dôvod ako auto-close.test.ts).
    await adminDb.delete(attendanceDays).where(and(eq(attendanceDays.workplaceId, workplaceId), eq(attendanceDays.status, "working")));
  });
});

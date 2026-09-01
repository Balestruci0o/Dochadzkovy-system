import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako pipnutia/actions.test.ts)
import { adminDb } from "@/lib/db/admin";
import { employees, employeeWorkplaces, missingPunchRequests, organizations, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { addDays, todayStr } from "@/lib/shared/dates";
import { requestMissingPunchAction } from "./actions";

/**
 * "Chýba mi pípnutie" — zamestnanecká strana. Na rozdiel od
 * `requestCorrectionAction` (opravuje EXISTUJÚCI deň, viazané na
 * `attendanceDayId`) toto vytvára samostatnú žiadosť viazanú na
 * employeeId+workplaceId+date, lebo `attendance_days` riadok pre úplne
 * vynechaný deň nemusí ešte existovať.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

let orgId: string;
let workplaceId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function freshEmployeeUser(name: string) {
  const [user] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `${crypto.randomUUID()}@missing-punch-test.local`, role: "employee", fullName: name })
    .returning();
  const [employee] = await adminDb.insert(employees).values({ orgId, userId: user.id, firstName: name, lastName: "Zamestnankyňa", hiredOn: "2024-01-01" }).returning();
  return { authUserId: user.authUserId as string, employeeId: employee.id };
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `Missing punch request test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("requestMissingPunchAction", () => {
  it("zamestnanec s členstvom v prevádzke vytvorí pending žiadosť", async () => {
    const emp = await freshEmployeeUser("Zabudnutá");
    await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.employeeId, workplaceId });
    const date = addDays(todayStr(), -1);

    authState.authUserId = emp.authUserId;
    const result = await requestMissingPunchAction(
      {},
      form({ workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "Terminál nefungoval." }),
    );
    expect(result.success).toBe(true);

    const [req] = await adminDb.select().from(missingPunchRequests).where(eq(missingPunchRequests.employeeId, emp.employeeId));
    expect(req.status).toBe("pending");
    expect(req.workplaceId).toBe(workplaceId);
    expect(req.date).toBe(date);
    expect(req.direction).toBe("in");
    expect(req.reason).toBe("Terminál nefungoval.");
  });

  it("zamestnanec BEZ členstva v prevádzke je odmietnutý", async () => {
    const emp = await freshEmployeeUser("Cudzia");
    const date = addDays(todayStr(), -1);

    authState.authUserId = emp.authUserId;
    const result = await requestMissingPunchAction({}, form({ workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "test" }));
    expect(result.error).toMatch(/nie si priradený/i);

    const reqs = await adminDb.select().from(missingPunchRequests).where(eq(missingPunchRequests.employeeId, emp.employeeId));
    expect(reqs).toHaveLength(0);
  });

  it("dátum v budúcnosti je odmietnutý", async () => {
    const emp = await freshEmployeeUser("Budúca");
    await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.employeeId, workplaceId });
    const future = addDays(todayStr(), 1);

    authState.authUserId = emp.authUserId;
    const result = await requestMissingPunchAction({}, form({ workplaceId, date: future, direction: "in", kind: "zmena", time: "09:00", reason: "test" }));
    expect(result.error).toMatch(/budúcnosti/i);
  });

  it("bez dôvodu je odmietnutý, nič nezapíše", async () => {
    const emp = await freshEmployeeUser("Bezdôvodná");
    await adminDb.insert(employeeWorkplaces).values({ employeeId: emp.employeeId, workplaceId });
    const date = addDays(todayStr(), -1);

    authState.authUserId = emp.authUserId;
    const result = await requestMissingPunchAction({}, form({ workplaceId, date, direction: "in", kind: "zmena", time: "09:00", reason: "" }));
    expect(result.error).toMatch(/vysvetli/i);

    const reqs = await adminDb.select().from(missingPunchRequests).where(eq(missingPunchRequests.employeeId, emp.employeeId));
    expect(reqs).toHaveLength(0);
  });
});

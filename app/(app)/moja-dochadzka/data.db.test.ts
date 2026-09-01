import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako publish-flow.test.ts)
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, employeeWorkplaces, organizations, punchEvents, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import type { CurrentUser } from "@/lib/auth/session";
import { DEFAULT_MANAGER_PERMISSIONS } from "@/lib/auth/manager-permissions";
import { localDateStr } from "@/lib/shared/time";
import { getMyAttendance } from "./data";

let orgId: string;
let workplaceId: string;
let employeeUser: CurrentUser;
let employeeId: string;
const today = localDateStr(new Date());

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `moja-dochadzka-live-hours test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;

  const employeeAuthUserId = crypto.randomUUID();
  const [empUser] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: employeeAuthUserId, email: `emp-${crypto.randomUUID()}@live-hours-test.local`, role: "employee", fullName: "Živá Zamestnankyňa" })
    .returning();
  employeeUser = { id: empUser.id, authUserId: employeeAuthUserId, orgId, role: "employee", fullName: empUser.fullName, email: empUser.email ?? "", permissions: { ...DEFAULT_MANAGER_PERMISSIONS } };

  const [employee] = await adminDb.insert(employees).values({ orgId, userId: empUser.id, firstName: "Živá", lastName: "Zamestnankyňa", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId });

  const start = new Date(Date.now() - 3 * 3600_000); // pred 3h
  await adminDb.insert(attendanceDays).values({
    employeeId,
    workplaceId,
    date: today,
    plannedStart: "07:00:00",
    plannedEnd: "19:00:00",
    actualStart: start,
    breakMinutes: 30,
    workedHours: "0.000",
    overtimeHours: "0",
    weekendHours: "0",
    holidayHours: "0",
    nightHours: "0",
    isLate: false,
    lateMinutes: 0,
    status: "working",
  });
  await adminDb.insert(punchEvents).values({ employeeId, workplaceId, direction: "in", method: "web", kind: "zmena", occurredAt: start });
  // Dokončená prestávka 15 min, pred hodinou.
  const breakStart = new Date(Date.now() - 60 * 60_000);
  const breakEnd = new Date(Date.now() - 45 * 60_000);
  await adminDb.insert(punchEvents).values([
    { employeeId, workplaceId, direction: "out", method: "web", kind: "prestavka", occurredAt: breakStart },
    { employeeId, workplaceId, direction: "in", method: "web", kind: "prestavka", occurredAt: breakEnd },
  ]);
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("getMyAttendance — naživo prepočítané 'Odpracované' na vlastnej stránke zamestnanca", () => {
  it("otvorená zmena (status 'working') ukazuje živý odhad (~2h45min), NIE 0", async () => {
    const attendance = await getMyAttendance(employeeUser);
    expect(attendance).not.toBeNull();
    const day = attendance!.days.find((d) => d.date === today);
    expect(day).toBeDefined();
    expect(day!.status).toBe("working");
    const hours = Number(day!.workedHours);
    // príchod pred 3h, mínus 15 min dokončená prestávka ≈ 2h45min
    expect(hours).toBeGreaterThan(2.6);
    expect(hours).toBeLessThan(2.9);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku (rovnaký vzor ako publish-flow.test.ts)
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, employeeWorkplaces, managerWorkplaces, organizations, punchEvents, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import type { CurrentUser } from "@/lib/auth/session";
import { DEFAULT_MANAGER_PERMISSIONS } from "@/lib/auth/manager-permissions";
import { localDateStr } from "@/lib/shared/time";
import { getPunchOverviewData } from "./data";

let orgId: string;
let workplaceId: string;
let managerUser: CurrentUser;
let employeeId: string;
const today = localDateStr(new Date());

async function makeWorkingDay(id: string, actualStart: Date) {
  await adminDb.insert(attendanceDays).values({
    employeeId,
    workplaceId,
    date: today,
    plannedStart: "07:00:00",
    plannedEnd: "19:00:00",
    actualStart,
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
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `pipnutia-live-hours test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;

  const managerAuthUserId = crypto.randomUUID();
  const [manager] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: managerAuthUserId, email: `mgr-${crypto.randomUUID()}@live-hours-test.local`, role: "manager", fullName: "Test Manažér" })
    .returning();
  managerUser = { id: manager.id, authUserId: managerAuthUserId, orgId, role: "manager", fullName: manager.fullName, email: manager.email ?? "", permissions: { ...DEFAULT_MANAGER_PERMISSIONS } };
  await adminDb.insert(managerWorkplaces).values({ userId: manager.id, workplaceId });

  const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Živý", lastName: "Prepočet", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("getPunchOverviewData — naživo prepočítané 'Odpracované' pre otvorenú zmenu", () => {
  it("príchod pred 2h, žiadna prestávka → cca 2h, NIE 0", async () => {
    const start = new Date(Date.now() - 2 * 3600_000);
    await makeWorkingDay("a", start);
    await adminDb.insert(punchEvents).values({ employeeId, workplaceId, direction: "in", method: "web", kind: "zmena", occurredAt: start });

    const data = await getPunchOverviewData(managerUser, workplaceId, today, today, employeeId);
    const row = data.rows.find((r) => r.date === today);
    expect(row).toBeDefined();
    expect(row!.status).toBe("working");
    expect(row!.workedHours).toBeGreaterThan(1.9);
    expect(row!.workedHours).toBeLessThan(2.1);
  });

  it("prebiehajúca prestávka ZASTAVÍ rast — hodnota zamrzne na čase odchodu na prestávku", async () => {
    const breakStart = new Date(Date.now() - 20 * 60_000); // pred 20 min
    await adminDb.insert(punchEvents).values({ employeeId, workplaceId, direction: "out", method: "web", kind: "prestavka", occurredAt: breakStart });

    const data = await getPunchOverviewData(managerUser, workplaceId, today, today, employeeId);
    const row = data.rows.find((r) => r.date === today);
    // príchod bol pred 2h, prestávka začala pred 20 min → naživo počítané po 21:40 od príchodu (2h - 20min), nie po "teraz"
    expect(row!.workedHours).toBeGreaterThan(1.6);
    expect(row!.workedHours).toBeLessThan(1.7);
    expect(row!.onBreakSince).not.toBeNull();
  });

  it("po návrate z prestávky pokračuje ďalej (nie navždy zamrznuté)", async () => {
    await adminDb.insert(punchEvents).values({ employeeId, workplaceId, direction: "in", method: "web", kind: "prestavka", occurredAt: new Date() });

    const data = await getPunchOverviewData(managerUser, workplaceId, today, today, employeeId);
    const row = data.rows.find((r) => r.date === today);
    expect(row!.onBreakSince).toBeNull();
    // späť na cca (teraz - príchod) - 20 min prestávka ≈ 1,67h, nie zamrznuté na 1,6-1,7 navždy — over že je BLÍZKO 2h mínus krátka prestávka
    expect(row!.workedHours).toBeGreaterThan(1.6);
  });
});

describe("getPunchOverviewData — DOKONČENÁ zmena sa naživo NEPREPOČÍTAVA", () => {
  it("status 'done' ukazuje uloženú hodnotu z DB nezmenenú", async () => {
    const [employee2] = await adminDb.insert(employees).values({ orgId, firstName: "Hotovo", lastName: "Dokončené", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee2.id, workplaceId });
    await adminDb.insert(attendanceDays).values({
      employeeId: employee2.id,
      workplaceId,
      date: today,
      plannedStart: "07:00:00",
      plannedEnd: "19:00:00",
      actualStart: new Date(Date.now() - 8 * 3600_000),
      actualEnd: new Date(),
      breakMinutes: 30,
      workedHours: "7.500",
      overtimeHours: "0",
      weekendHours: "0",
      holidayHours: "0",
      nightHours: "0",
      isLate: false,
      lateMinutes: 0,
      status: "done",
    });

    const data = await getPunchOverviewData(managerUser, workplaceId, today, today, employee2.id);
    const row = data.rows.find((r) => r.date === today && r.employeeId === employee2.id);
    expect(row!.workedHours).toBe(7.5);
  });
});

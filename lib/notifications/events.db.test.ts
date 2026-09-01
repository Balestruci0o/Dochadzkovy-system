import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/prevádzku/žiadosti priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import {
  employees,
  employeeWorkplaces,
  managerWorkplaces,
  notifications,
  organizations,
  scheduledShifts,
  schedules,
  shiftTemplates,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { notifyAbsenceRequestSubmitted, notifySchedulePublished } from "./events";

/**
 * "kedy" vrstva: KTO presne dostane notifikáciu pre
 * danú udalosť. Testuje sa reálny beh cez `withUserContext` (nie mock),
 * presne ako zvyšok scheduler/db-loader testov v tejto session.
 */

let orgId: string;
let workplaceId: string;
let ownerId: string;
let managerId: string;
let employeeUserId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `notifications events test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [owner] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `owner-${crypto.randomUUID()}@events-test.local`, role: "owner", fullName: "Test Majiteľ" })
    .returning();
  ownerId = owner.id;

  const [manager] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `manager-${crypto.randomUUID()}@events-test.local`, role: "manager", fullName: "Test Manažér" })
    .returning();
  managerId = manager.id;
  await adminDb.insert(managerWorkplaces).values({ userId: managerId, workplaceId });

  const [employeeUser] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `emp-acting-${crypto.randomUUID()}@events-test.local`, role: "employee", fullName: "Konajúci Zamestnanec" })
    .returning();
  employeeUserId = employeeUser.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("notifyAbsenceRequestSubmitted — príjemcovia", () => {
  it("notifikáciu dostane manažér PREVÁDZKY aj owner organizácie, nikto iný, ŽIADNA DUPLICITA", async () => {
    await withUserContext(ownerId, (tx) =>
      notifyAbsenceRequestSubmitted(tx, { orgId, workplaceId, employeeName: "Jana Nováková", kindLabel: "Dovolenka", dateFrom: "2027-05-01", dateTo: "2027-05-03" }),
    );

    const ownerNotifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, ownerId), eq(notifications.kind, "absence_request_submitted")));
    const managerNotifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, managerId), eq(notifications.kind, "absence_request_submitted")));

    expect(ownerNotifs).toHaveLength(1);
    expect(managerNotifs).toHaveLength(1);
    expect(ownerNotifs[0].title).toContain("dovolenka");
    expect(ownerNotifs[0].body).toContain("Jana Nováková");
    expect(ownerNotifs[0].link).toBe("/ziadosti");
  });

  it("REÁLNY nález (Playwright): keď udalosť spúšťa ZAMESTNANEC (nie owner), manažér AJ owner sa AJ TAK dozvedia — ich riadky nevidí, ale notifikácia sa im pošle (migrácia 0020)", async () => {
    // Pred migráciou 0020 `getManagersAndOwner` čítal manager_workplaces/users
    // POD IDENTITOU KONAJÚCEHO — zamestnanec nevidí cudzie riadky (RLS),
    // dopyt vrátil 0 príjemcov, notifikácia sa nikomu nepošle, potichu.
    await withUserContext(employeeUserId, (tx) =>
      notifyAbsenceRequestSubmitted(tx, { orgId, workplaceId, employeeName: "Konajúci Zamestnanec", kindLabel: "PN", dateFrom: "2027-05-10", dateTo: "2027-05-10" }),
    );

    const ownerNotifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, ownerId), eq(notifications.kind, "absence_request_submitted"), eq(notifications.body, "Konajúci Zamestnanec, 2027-05-10")));
    const managerNotifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, managerId), eq(notifications.kind, "absence_request_submitted"), eq(notifications.body, "Konajúci Zamestnanec, 2027-05-10")));

    expect(ownerNotifs).toHaveLength(1);
    expect(managerNotifs).toHaveLength(1);
  });
});

describe("notifySchedulePublished — príjemcovia", () => {
  it("notifikáciu dostane KAŽDÝ zamestnanec s aspoň 1 zmenou v tomto rozvrhu, cez employees.user_id (nie employees.id)", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Publikovaný", lastName: "Zamestnanec", hiredOn: "2024-01-01" }).returning();
    const [empUser] = await adminDb
      .insert(users)
      .values({ orgId, authUserId: crypto.randomUUID(), email: `emp-${crypto.randomUUID()}@events-test.local`, role: "employee", fullName: "Publikovaný Zamestnanec" })
      .returning();
    await adminDb.update(employees).set({ userId: empUser.id }).where(eq(employees.id, employee.id));
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });

    const [template] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId, name: "Ranná", code: `R-${crypto.randomUUID().slice(0, 8)}`, startTime: "07:00:00", endTime: "15:00:00" })
      .returning();
    const [schedule] = await adminDb.insert(schedules).values({ workplaceId, year: 2027, month: 6 }).returning();
    await adminDb.insert(scheduledShifts).values({ scheduleId: schedule.id, employeeId: employee.id, workplaceId, date: "2027-06-01", shiftTemplateId: template.id, startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 });

    await withUserContext(ownerId, (tx) => notifySchedulePublished(tx, { scheduleId: schedule.id, workplaceName: "Hotel", year: 2027, month: 6 }));

    const empNotifs = await adminDb.select().from(notifications).where(and(eq(notifications.userId, empUser.id), eq(notifications.kind, "schedule_published")));
    expect(empNotifs).toHaveLength(1);
    expect(empNotifs[0].title).toBe("Nový rozvrh zverejnený");
    expect(empNotifs[0].body).toContain("Hotel");
  });

  it("zamestnanec BEZ vlastného users účtu sa nepokazí (preskočí sa, nespadne)", async () => {
    const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Bez", lastName: "Uctu", hiredOn: "2024-01-01" }).returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });

    const [template] = await adminDb
      .insert(shiftTemplates)
      .values({ workplaceId, name: "Poobedná", code: `P-${crypto.randomUUID().slice(0, 8)}`, startTime: "14:00:00", endTime: "22:00:00" })
      .returning();
    const [schedule] = await adminDb.insert(schedules).values({ workplaceId, year: 2027, month: 7 }).returning();
    await adminDb.insert(scheduledShifts).values({ scheduleId: schedule.id, employeeId: employee.id, workplaceId, date: "2027-07-01", shiftTemplateId: template.id, startTime: "14:00:00", endTime: "22:00:00", breakMinutes: 30 });

    await expect(
      withUserContext(ownerId, (tx) => notifySchedulePublished(tx, { scheduleId: schedule.id, workplaceName: "Hotel", year: 2027, month: 7 })),
    ).resolves.not.toThrow();
  });
});

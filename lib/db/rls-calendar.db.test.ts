import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { withUserContext } from "./index";
import { getOrCreateSchedule } from "@/app/(app)/kalendar/schedule";
import { deleteOrgCascade } from "./test-fixture";
import {
  absences,
  employees,
  employeeWorkplaces,
  managerWorkplaces,
  organizations,
  scheduledShifts,
  shiftTemplates,
  users,
  workplaces,
} from "./schema";

/**
 * Kalendár rozvrhu — RLS na `absences` (predtým bez policy), upsert vzor
 * pre scheduled_shifts (manuálna zmena = source 'manual', locked true) a
 * vzájomná výlučnosť zmena/absencia (jeden deň je buď zmena, alebo
 * absencia, nikdy oboje).
 */

let orgId: string;
let otherOrgId: string;
let hotelId: string;
let officeId: string;
let managerHotelUserId: string;
let managerOfficeUserId: string;
let employeeId: string;
let shiftTemplateId: string;

beforeAll(async () => {
  const [org, otherOrg] = await adminDb
    .insert(organizations)
    .values([
      { name: `RLS-calendar test org ${crypto.randomUUID()}` },
      { name: `RLS-calendar test org OTHER ${crypto.randomUUID()}` },
    ])
    .returning();
  orgId = org.id;
  otherOrgId = otherOrg.id;

  const [hotel, office] = await adminDb
    .insert(workplaces)
    .values([
      { orgId, name: "Hotel", code: "HOTEL" },
      { orgId, name: "Office", code: "OFFICE" },
    ])
    .returning();
  hotelId = hotel.id;
  officeId = office.id;

  const [managerHotel, managerOffice] = await adminDb
    .insert(users)
    .values([
      { orgId, email: "manager.hotel@rls-cal-test.local", role: "manager", fullName: "Manažér Hotel" },
      { orgId, email: "manager.office@rls-cal-test.local", role: "manager", fullName: "Manažér Office" },
    ])
    .returning();
  managerHotelUserId = managerHotel.id;
  managerOfficeUserId = managerOffice.id;

  await adminDb.insert(managerWorkplaces).values([
    { userId: managerHotelUserId, workplaceId: hotelId },
    { userId: managerOfficeUserId, workplaceId: officeId },
  ]);

  const [employee] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Jana", lastName: "Testovacia", hiredOn: "2024-01-01" })
    .returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId: hotelId });

  const [template] = await adminDb
    .insert(shiftTemplates)
    .values({ workplaceId: hotelId, name: "Ranná", code: "R", startTime: "07:00", endTime: "15:00", breakMinutes: 30 })
    .returning();
  shiftTemplateId = template.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
  await deleteOrgCascade(otherOrgId);
});

describe("RLS: absences (predtým RLS zapnuté, ale žiadna policy — appka nevidela nič)", () => {
  it("manažér Hotela smie zapísať absenciu zamestnancovi vo svojej prevádzke", async () => {
    await expect(
      withUserContext(managerHotelUserId, (tx) =>
        tx.insert(absences).values({ employeeId, workplaceId: hotelId, date: "2026-08-01", kind: "dovolenka", isConfirmed: true }),
      ),
    ).resolves.not.toThrow();

    const rows = await adminDb.select().from(absences).where(eq(absences.employeeId, employeeId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "dovolenka", isConfirmed: true });

    await adminDb.delete(absences).where(eq(absences.employeeId, employeeId));
  });

  it("manažér Office (cudzia prevádzka) NEMÔŽE zapísať absenciu zamestnancovi Hotela", async () => {
    await expect(
      withUserContext(managerOfficeUserId, (tx) =>
        tx.insert(absences).values({ employeeId, workplaceId: hotelId, date: "2026-08-02", kind: "pn", isConfirmed: true }),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error && /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });
});

describe("getOrCreateSchedule — nájde alebo založí schedules riadok (idempotentné)", () => {
  it("prvé volanie založí, druhé volanie pre ten istý mesiac vráti to isté ID", async () => {
    const first = await withUserContext(managerHotelUserId, (tx) => getOrCreateSchedule(tx, hotelId, 2026, 9));
    const second = await withUserContext(managerHotelUserId, (tx) => getOrCreateSchedule(tx, hotelId, 2026, 9));

    expect(first.id).toBe(second.id);
    expect(first.status).toBe("draft");
  });
});

describe("manuálna zmena — source='manual', locked=true, upsert prepíše existujúci riadok", () => {
  it("insert nastaví manual+locked; opakovaný upsert na ten istý deň zmení šablónu, nie duplicitu", async () => {
    const schedule = await withUserContext(managerHotelUserId, (tx) => getOrCreateSchedule(tx, hotelId, 2026, 10));

    await withUserContext(managerHotelUserId, (tx) =>
      tx.insert(scheduledShifts).values({
        scheduleId: schedule.id,
        employeeId,
        workplaceId: hotelId,
        date: "2026-10-05",
        shiftTemplateId,
        startTime: "07:00",
        endTime: "15:00",
        breakMinutes: 30,
        source: "manual",
        locked: true,
      }),
    );

    const [row1] = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.date, "2026-10-05")));
    expect(row1).toMatchObject({ source: "manual", locked: true, startTime: "07:00:00" });

    // upsert (rovnaký vzor ako assignShiftAction) — iný čas, stále manual+locked
    await withUserContext(managerHotelUserId, (tx) =>
      tx
        .insert(scheduledShifts)
        .values({
          scheduleId: schedule.id,
          employeeId,
          workplaceId: hotelId,
          date: "2026-10-05",
          shiftTemplateId,
          startTime: "09:00",
          endTime: "17:00",
          breakMinutes: 30,
          source: "manual",
          locked: true,
        })
        .onConflictDoUpdate({
          target: [scheduledShifts.employeeId, scheduledShifts.workplaceId, scheduledShifts.date],
          set: { startTime: "09:00", endTime: "17:00", source: "manual", locked: true },
        }),
    );

    const rows = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.date, "2026-10-05")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startTime: "09:00:00", source: "manual", locked: true });

    await adminDb.delete(scheduledShifts).where(eq(scheduledShifts.employeeId, employeeId));
  });
});

describe("deň je buď zmena, alebo absencia — nikdy oboje (rovnaká sekvencia ako assign*Action)", () => {
  it("priradenie absencie zmaže existujúcu zmenu v ten istý deň", async () => {
    const schedule = await withUserContext(managerHotelUserId, (tx) => getOrCreateSchedule(tx, hotelId, 2026, 11));

    await withUserContext(managerHotelUserId, (tx) =>
      tx.insert(scheduledShifts).values({
        scheduleId: schedule.id,
        employeeId,
        workplaceId: hotelId,
        date: "2026-11-10",
        shiftTemplateId,
        startTime: "07:00",
        endTime: "15:00",
        breakMinutes: 30,
        source: "manual",
        locked: true,
      }),
    );

    // presne postup z assignAbsenceAction: zmaž scheduled_shifts, vlož absences
    await withUserContext(managerHotelUserId, async (tx) => {
      await tx
        .delete(scheduledShifts)
        .where(
          and(
            eq(scheduledShifts.employeeId, employeeId),
            eq(scheduledShifts.workplaceId, hotelId),
            eq(scheduledShifts.date, "2026-11-10"),
          ),
        );
      await tx.insert(absences).values({ employeeId, workplaceId: hotelId, date: "2026-11-10", kind: "pn", isConfirmed: true });
    });

    const shiftRows = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.date, "2026-11-10")));
    const absenceRows = await adminDb
      .select()
      .from(absences)
      .where(and(eq(absences.employeeId, employeeId), eq(absences.date, "2026-11-10")));

    expect(shiftRows).toHaveLength(0);
    expect(absenceRows).toHaveLength(1);

    await adminDb.delete(absences).where(eq(absences.employeeId, employeeId));
  });

  it("priradenie zmeny zmaže existujúcu absenciu v ten istý deň", async () => {
    const schedule = await withUserContext(managerHotelUserId, (tx) => getOrCreateSchedule(tx, hotelId, 2026, 11));

    await adminDb
      .insert(absences)
      .values({ employeeId, workplaceId: hotelId, date: "2026-11-15", kind: "dovolenka", isConfirmed: true });

    // presne postup z assignShiftAction: zmaž absences, vlož/upsertni scheduled_shifts
    await withUserContext(managerHotelUserId, async (tx) => {
      await tx.delete(absences).where(and(eq(absences.employeeId, employeeId), eq(absences.date, "2026-11-15")));
      await tx.insert(scheduledShifts).values({
        scheduleId: schedule.id,
        employeeId,
        workplaceId: hotelId,
        date: "2026-11-15",
        shiftTemplateId,
        startTime: "07:00",
        endTime: "15:00",
        breakMinutes: 30,
        source: "manual",
        locked: true,
      });
    });

    const shiftRows = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.date, "2026-11-15")));
    const absenceRows = await adminDb
      .select()
      .from(absences)
      .where(and(eq(absences.employeeId, employeeId), eq(absences.date, "2026-11-15")));

    expect(shiftRows).toHaveLength(1);
    expect(absenceRows).toHaveLength(0);

    await adminDb.delete(scheduledShifts).where(eq(scheduledShifts.employeeId, employeeId));
  });
});

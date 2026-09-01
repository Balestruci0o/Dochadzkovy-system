import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { withUserContext } from "./index";
import {
  employeePositionHistory,
  employeeRateHistory,
  employees,
  employeeWorkplaces,
  managerWorkplaces,
  organizations,
  positions,
  users,
  workplaces,
} from "./schema";
import { deleteOrgCascade } from "./test-fixture";

/**
 * Blok 4 — RLS oprava (employees_insert_manager) + história pozícií/sadzieb
 * (close-old/open-new, EXCLUDE constraint proti prekrývaniu).
 */

let orgId: string;
let otherOrgId: string;
let hotelId: string;
let managerHotelUserId: string;
let positionAId: string;
let positionBId: string;

beforeAll(async () => {
  const [org, otherOrg] = await adminDb
    .insert(organizations)
    .values([
      { name: `RLS-employees test org ${crypto.randomUUID()}` },
      { name: `RLS-employees test org OTHER ${crypto.randomUUID()}` },
    ])
    .returning();
  orgId = org.id;
  otherOrgId = otherOrg.id;

  const [hotel] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  hotelId = hotel.id;

  const [managerHotel] = await adminDb
    .insert(users)
    .values({ orgId, email: "manager.hotel@rls-emp-test.local", role: "manager", fullName: "Manažér Hotel" })
    .returning();
  managerHotelUserId = managerHotel.id;

  await adminDb.insert(managerWorkplaces).values({ userId: managerHotelUserId, workplaceId: hotelId });

  const [posA, posB] = await adminDb
    .insert(positions)
    .values([
      { orgId, workplaceId: hotelId, name: "Recepcia" },
      { orgId, workplaceId: hotelId, name: "Chyžná" },
    ])
    .returning();
  positionAId = posA.id;
  positionBId = posB.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
  await deleteOrgCascade(otherOrgId);
});

describe("RLS: emp_select — zamestnanec vidí VLASTNÝ riadok (0026_employees_self_select)", () => {
  /**
   * Nájdené pri reálnom overení /punch v prehliadači (pípanie prestávok,
   * krok 3): `emp_select` malo owner + manažér vetvu, ale ZABUDLO na
   * `current_employee_id()` — žiadny zamestnanec si nevedel prečítať vlastný
   * `employees` riadok cez bežnú (session) cestu, takže `/punch` aj
   * `GET /api/qr-token` vždy skončili "employee not found".
   */
  it("zamestnanec BEZ manažérskeho prekrytia (iná prevádzka než akákoľvek manager_workplaces) vidí SEBA", async () => {
    const [otherWorkplace] = await adminDb
      .insert(workplaces)
      .values({ orgId, name: "Office (mimo manažéra)", code: "OFFICE-SELF" })
      .returning();

    const [selfUser] = await adminDb
      .insert(users)
      .values({ orgId, email: "self-employee@rls-emp-test.local", role: "employee", fullName: "Sám Sebe" })
      .returning();

    const [selfEmployee] = await adminDb
      .insert(employees)
      .values({ orgId, userId: selfUser.id, firstName: "Sám", lastName: "Sebe", hiredOn: "2024-01-01" })
      .returning();
    await adminDb.insert(employeeWorkplaces).values({ employeeId: selfEmployee.id, workplaceId: otherWorkplace.id });

    const rows = await withUserContext(selfUser.id, (tx) =>
      tx.select().from(employees).where(eq(employees.id, selfEmployee.id)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(selfEmployee.id);
  });

  it("zamestnanec NEVIDÍ kolegu (iný employees riadok, nie ten svoj)", async () => {
    const [selfUser] = await adminDb
      .insert(users)
      .values({ orgId, email: "self-employee-2@rls-emp-test.local", role: "employee", fullName: "Druhý Sebe" })
      .returning();
    await adminDb.insert(employees).values({ orgId, userId: selfUser.id, firstName: "Druhý", lastName: "Sebe", hiredOn: "2024-01-01" });

    const [colleague] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Kolega", lastName: "Cudzí", hiredOn: "2024-01-01" })
      .returning();

    const rows = await withUserContext(selfUser.id, (tx) =>
      tx.select().from(employees).where(eq(employees.id, colleague.id)),
    );
    expect(rows).toHaveLength(0);
  });
});

describe("RLS: employees_insert_manager", () => {
  it("manažér smie založiť zamestnanca vo VLASTNEJ organizácii", async () => {
    await expect(
      withUserContext(managerHotelUserId, (tx) =>
        tx.insert(employees).values({
          id: crypto.randomUUID(),
          orgId,
          firstName: "Nový",
          lastName: "Zamestnanec",
          hiredOn: "2026-01-01",
        }),
      ),
    ).resolves.not.toThrow();

    await adminDb.delete(employees).where(and(eq(employees.orgId, orgId), eq(employees.firstName, "Nový")));
  });

  it("manažér NEMÔŽE založiť zamestnanca v cudzej organizácii", async () => {
    await expect(
      withUserContext(managerHotelUserId, (tx) =>
        tx.insert(employees).values({
          id: crypto.randomUUID(),
          orgId: otherOrgId,
          firstName: "Pokus",
          lastName: "Cudzia Org",
          hiredOn: "2026-01-01",
        }),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );
  });
});

describe("história pozícií — zavri starú, otvor novú (nikdy sa neprepisuje)", () => {
  it("zmena pozície uzavrie starý riadok presne v deň, keď začína nový", async () => {
    const employeeId = crypto.randomUUID();
    await adminDb.insert(employees).values({
      id: employeeId,
      orgId,
      firstName: "Jana",
      lastName: "Testovacia",
      hiredOn: "2024-01-01",
    });
    await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId: hotelId });

    // prvá pozícia
    await adminDb
      .insert(employeePositionHistory)
      .values({ employeeId, positionId: positionAId, validFrom: "2024-01-01" });

    // zmena pozície od 2026-06-01 — zavri starú (2024-01-01 → 2026-06-01), otvor novú
    await withUserContext(managerHotelUserId, async (tx) => {
      await tx
        .update(employeePositionHistory)
        .set({ validTo: "2026-06-01" })
        .where(and(eq(employeePositionHistory.employeeId, employeeId), isNull(employeePositionHistory.validTo)));
      await tx.insert(employeePositionHistory).values({
        employeeId,
        positionId: positionBId,
        validFrom: "2026-06-01",
      });
    });

    const rows = await adminDb
      .select()
      .from(employeePositionHistory)
      .where(eq(employeePositionHistory.employeeId, employeeId))
      .orderBy(employeePositionHistory.validFrom);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ positionId: positionAId, validFrom: "2024-01-01", validTo: "2026-06-01" });
    expect(rows[1]).toMatchObject({ positionId: positionBId, validFrom: "2026-06-01", validTo: null });

    await adminDb.delete(employees).where(eq(employees.id, employeeId));
  });

  it("EXCLUDE constraint odmietne prekrývajúce sa obdobia pozícií", async () => {
    const employeeId = crypto.randomUUID();
    await adminDb.insert(employees).values({
      id: employeeId,
      orgId,
      firstName: "Peter",
      lastName: "Testovaci",
      hiredOn: "2024-01-01",
    });

    await adminDb
      .insert(employeePositionHistory)
      .values({ employeeId, positionId: positionAId, validFrom: "2024-01-01", validTo: "2026-06-01" });

    // pokus vložiť pozíciu, ktorá sa prekrýva s existujúcim obdobím
    await expect(
      adminDb
        .insert(employeePositionHistory)
        .values({ employeeId, positionId: positionBId, validFrom: "2025-01-01" }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error && /exclusion/i.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );

    await adminDb.delete(employees).where(eq(employees.id, employeeId));
  });
});

describe("história sadzieb — rovnaký princíp, len owner smie zapisovať", () => {
  it("manažér NEMÔŽE zapísať sadzbu (rate_write je owner-only)", async () => {
    const employeeId = crypto.randomUUID();
    await adminDb.insert(employees).values({
      id: employeeId,
      orgId,
      firstName: "Eva",
      lastName: "Testovacia",
      hiredOn: "2024-01-01",
    });
    await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId: hotelId });

    await expect(
      withUserContext(managerHotelUserId, (tx) =>
        tx.insert(employeeRateHistory).values({
          employeeId,
          workplaceId: hotelId,
          hourlyRate: "7.5000",
          validFrom: "2024-01-01",
        }),
      ),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error &&
        /row-level security/.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );

    await adminDb.delete(employees).where(eq(employees.id, employeeId));
  });

  it("EXCLUDE constraint odmietne prekrývajúce sa sadzby v tej istej prevádzke", async () => {
    const employeeId = crypto.randomUUID();
    await adminDb.insert(employees).values({
      id: employeeId,
      orgId,
      firstName: "Milan",
      lastName: "Testovaci",
      hiredOn: "2024-01-01",
    });

    await adminDb.insert(employeeRateHistory).values({
      employeeId,
      workplaceId: hotelId,
      hourlyRate: "6.5000",
      validFrom: "2024-01-01",
      validTo: "2026-01-01",
    });

    await expect(
      adminDb.insert(employeeRateHistory).values({
        employeeId,
        workplaceId: hotelId,
        hourlyRate: "7.0000",
        validFrom: "2025-06-01",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof Error && /exclusion/i.test(String((err as { cause?: unknown }).cause ?? err.message)),
    );

    await adminDb.delete(employees).where(eq(employees.id, employeeId));
  });
});

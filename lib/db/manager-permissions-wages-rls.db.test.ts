import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { employeeRateHistory, employees, employeeSalaryHistory, employeeWorkplaces, managerPermissions, managerWorkplaces, organizations, users, workplaces } from "./schema";
import { deleteOrgCascade } from "./test-fixture";

/**
 * Granulárne pravomoci manažérov, Fáza 4 (Mzdy) — POSLEDNÁ fáza. RLS testy
 * pod "authenticated" (rovnaký vzor ako predošlé tri súbory).
 *
 * view_wages je JEDINÁ politika v CELEJ tejto funkcii, čo sa SPRÍSŇUJE —
 * kritické je overiť OBOMA smermi: (1) default (žiadny riadok) = dnešné
 * správanie NEZMENENÉ, (2) explicitné view_wages=false NAOZAJ nevráti
 * riadky (nie len že UI schová sumu).
 */

const rawSql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function asAuthenticatedUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return rawSql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

let orgId: string;
let otherOrgId: string;
let workplaceId: string;
let otherWorkplaceId: string;
let ownerUserId: string;
let accountantUserId: string;
let managerNoRowUserId: string; // žiadny manager_permissions riadok — dnešné správanie
let managerViewOnlyUserId: string; // view_wages=true (explicitne), edit_wages=false
let managerHiddenUserId: string; // view_wages=false (explicitne)
let managerEditUserId: string; // edit_wages=true, vlastná prevádzka
let otherOrgManagerEditUserId: string;
let employeeId: string;
let otherWorkplaceEmployeeId: string; // v INEJ prevádzke, mimo scope managerEditUserId

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `mp-wages-rls test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [otherOrg] = await adminDb.insert(organizations).values({ name: `mp-wages-rls test — iná org ${crypto.randomUUID()}` }).returning();
  otherOrgId = otherOrg.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;
  const [otherWp] = await adminDb.insert(workplaces).values({ orgId, name: "Office", code: `OFFICE-${crypto.randomUUID().slice(0, 8)}` }).returning();
  otherWorkplaceId = otherWp.id;

  const [owner, accountant, managerNoRow, managerViewOnly, managerHidden, managerEdit] = await adminDb
    .insert(users)
    .values([
      { orgId, email: `owner-${crypto.randomUUID()}@mp-wages-rls.local`, role: "owner", fullName: "Majiteľ" },
      { orgId, email: `acc-${crypto.randomUUID()}@mp-wages-rls.local`, role: "accountant", fullName: "Účtovníčka" },
      { orgId, email: `mgr-norow-${crypto.randomUUID()}@mp-wages-rls.local`, role: "manager", fullName: "Manažér bez riadku" },
      { orgId, email: `mgr-viewonly-${crypto.randomUUID()}@mp-wages-rls.local`, role: "manager", fullName: "Manažér view_wages=true" },
      { orgId, email: `mgr-hidden-${crypto.randomUUID()}@mp-wages-rls.local`, role: "manager", fullName: "Manažér view_wages=false" },
      { orgId, email: `mgr-edit-${crypto.randomUUID()}@mp-wages-rls.local`, role: "manager", fullName: "Manažér edit_wages=true" },
    ])
    .returning();
  ownerUserId = owner.id;
  accountantUserId = accountant.id;
  managerNoRowUserId = managerNoRow.id;
  managerViewOnlyUserId = managerViewOnly.id;
  managerHiddenUserId = managerHidden.id;
  managerEditUserId = managerEdit.id;

  const [otherOrgManager] = await adminDb
    .insert(users)
    .values({ orgId: otherOrgId, email: `mgr-${crypto.randomUUID()}@mp-wages-rls.local`, role: "manager", fullName: "Manažér inej org" })
    .returning();
  otherOrgManagerEditUserId = otherOrgManager.id;

  // Všetci manažéri majú manager_workplaces na `workplaceId`.
  await adminDb.insert(managerWorkplaces).values([
    { userId: managerViewOnlyUserId, workplaceId },
    { userId: managerHiddenUserId, workplaceId },
    { userId: managerEditUserId, workplaceId },
  ]);
  // managerNoRow tiež musí mať prístup na prevádzku, aby sme testovali VÝHRADNE view_wages default, nie chýbajúci workplace scope.
  await adminDb.insert(managerWorkplaces).values({ userId: managerNoRowUserId, workplaceId });

  await adminDb.insert(managerPermissions).values([
    { userId: managerViewOnlyUserId, viewWages: true, editWages: false },
    { userId: managerHiddenUserId, viewWages: false, editWages: false },
    { userId: managerEditUserId, viewWages: true, editWages: true },
  ]);
  await adminDb.insert(managerPermissions).values({ userId: otherOrgManagerEditUserId, viewWages: true, editWages: true });

  const [employee] = await adminDb.insert(employees).values({ orgId, firstName: "Zamestnankyňa", lastName: "Testová", hiredOn: "2024-01-01" }).returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId });
  await adminDb.insert(employeeRateHistory).values({ employeeId, workplaceId, hourlyRate: "10.0000", validFrom: "2024-01-01" });
  await adminDb.insert(employeeSalaryHistory).values({ employeeId, fixAmount: "800.00", variableAmount: "50.00", validFrom: "2024-01-01" });

  // Zamestnanec v INEJ prevádzke (Office) — mimo scope managerEditUserId (ten je len na Hotel).
  const [otherWpEmployee] = await adminDb.insert(employees).values({ orgId, firstName: "Iná", lastName: "Prevádzka", hiredOn: "2024-01-01" }).returning();
  otherWorkplaceEmployeeId = otherWpEmployee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: otherWorkplaceEmployeeId, workplaceId: otherWorkplaceId });
  await adminDb.insert(employeeRateHistory).values({ employeeId: otherWorkplaceEmployeeId, workplaceId: otherWorkplaceId, hourlyRate: "11.0000", validFrom: "2024-01-01" });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
  await deleteOrgCascade(otherOrgId);
  await rawSql.end();
});

describe("KRITICKÉ — view_wages default (žiadny riadok) = dnešné správanie NEZMENENÉ", () => {
  it("manažér BEZ manager_permissions riadku VIDÍ sadzbu aj plat (presne ako dnes)", async () => {
    const rates = await asAuthenticatedUser(managerNoRowUserId, (tx) => tx`SELECT hourly_rate FROM employee_rate_history WHERE employee_id = ${employeeId}`);
    expect(rates).toHaveLength(1);
    expect(Number(rates[0].hourly_rate)).toBeCloseTo(10, 4);

    const salaries = await asAuthenticatedUser(managerNoRowUserId, (tx) => tx`SELECT fix_amount FROM employee_salary_history WHERE employee_id = ${employeeId}`);
    expect(salaries).toHaveLength(1);
  });
});

describe("KRITICKÉ — view_wages=false: RLS naozaj NEVRÁTI riadky (nie len že UI schová sumu)", () => {
  it("manažér s view_wages=false NEVIDÍ sadzbu (SELECT vráti 0 riadkov, nie chybu)", async () => {
    const rows = await asAuthenticatedUser(managerHiddenUserId, (tx) => tx`SELECT id FROM employee_rate_history WHERE employee_id = ${employeeId}`);
    expect(rows).toHaveLength(0);
  });

  it("manažér s view_wages=false NEVIDÍ fixný plat (SELECT vráti 0 riadkov)", async () => {
    const rows = await asAuthenticatedUser(managerHiddenUserId, (tx) => tx`SELECT id FROM employee_salary_history WHERE employee_id = ${employeeId}`);
    expect(rows).toHaveLength(0);
  });

  it("manažér s view_wages=true (explicitný riadok) VIDÍ sadzbu aj plat — potvrdzuje, že riadok PREBÍJA default rovnako oboma smermi", async () => {
    const rates = await asAuthenticatedUser(managerViewOnlyUserId, (tx) => tx`SELECT id FROM employee_rate_history WHERE employee_id = ${employeeId}`);
    expect(rates).toHaveLength(1);
  });
});

describe("KRITICKÉ — edit_wages BEZ pravomoci: priamy SQL pokus zamietnutý RLS", () => {
  it("manažér BEZ edit_wages (aj s view_wages=true) NEVIE vytvoriť novú sadzbu (INSERT zamietnutý)", async () => {
    await expect(
      asAuthenticatedUser(
        managerViewOnlyUserId,
        (tx) => tx`INSERT INTO employee_rate_history (employee_id, workplace_id, hourly_rate, valid_from) VALUES (${employeeId}, ${workplaceId}, 99, '2030-01-01')`,
      ),
    ).rejects.toThrow();
  });

  it("manažér BEZ edit_wages NEVIE zmeniť fixný plat (UPDATE zamietnutý alebo tichých 0 riadkov)", async () => {
    const result = await asAuthenticatedUser(
      managerViewOnlyUserId,
      (tx) => tx`UPDATE employee_salary_history SET fix_amount = 9999 WHERE employee_id = ${employeeId} RETURNING id`,
    );
    expect(result).toHaveLength(0);
    const [unchanged] = await adminDb.select({ fixAmount: employeeSalaryHistory.fixAmount }).from(employeeSalaryHistory).where(eq(employeeSalaryHistory.employeeId, employeeId));
    expect(Number(unchanged.fixAmount)).toBeCloseTo(800, 2);
  });
});

describe("Čo manažér s edit_wages=true SKUTOČNE smie — scoping na vlastnú prevádzku drží presne ako pri view", () => {
  it("VIE vytvoriť novú sadzbu pre zamestnanca VO VLASTNEJ prevádzke", async () => {
    // Existujúci riadok z fixtúry je open-ended (bez valid_to) — najprv ho
    // zavrieť (presne ako changeRateAction), inak EXCLUDE constraint správne
    // odmietne prekrývajúci sa rozsah (nesúvisí s RLS, čisto dátová hygiena).
    await asAuthenticatedUser(managerEditUserId, (tx) => tx`UPDATE employee_rate_history SET valid_to = '2029-12-31' WHERE employee_id = ${employeeId} AND valid_to IS NULL`);
    const inserted = await asAuthenticatedUser(
      managerEditUserId,
      (tx) => tx`INSERT INTO employee_rate_history (employee_id, workplace_id, hourly_rate, valid_from) VALUES (${employeeId}, ${workplaceId}, 12, '2030-01-01') RETURNING id`,
    );
    expect(inserted).toHaveLength(1);
  });

  it("VIE zmeniť fixný plat zamestnanca VO VLASTNEJ prevádzke", async () => {
    const updated = await asAuthenticatedUser(
      managerEditUserId,
      (tx) => tx`UPDATE employee_salary_history SET variable_amount = 75 WHERE employee_id = ${employeeId} RETURNING variable_amount`,
    );
    expect(updated).toHaveLength(1);
    expect(Number(updated[0].variable_amount)).toBeCloseTo(75, 2);
  });

  it("NEVIE zapísať sadzbu zamestnancovi v CUDZEJ (nie vlastnej) prevádzke — scoping platí aj pre edit_wages", async () => {
    await expect(
      asAuthenticatedUser(
        managerEditUserId,
        (tx) => tx`INSERT INTO employee_rate_history (employee_id, workplace_id, hourly_rate, valid_from) VALUES (${otherWorkplaceEmployeeId}, ${otherWorkplaceId}, 13, '2030-01-01')`,
      ),
    ).rejects.toThrow();
  });

  it("NEVIE zapisovať do CUDZEJ organizácie (cross-org izolácia platí aj s edit_wages=true)", async () => {
    await expect(
      asAuthenticatedUser(
        otherOrgManagerEditUserId,
        (tx) => tx`INSERT INTO employee_rate_history (employee_id, workplace_id, hourly_rate, valid_from) VALUES (${employeeId}, ${workplaceId}, 14, '2030-01-01')`,
      ),
    ).rejects.toThrow();
  });
});

describe("ANTI-ESKALÁCIA — edit_wages/view_wages neobchádzajú NIČ INÉ", () => {
  it("manažér s edit_wages=true STÁLE nevidí majiteľské konto (nezávislý balíček, Fáza 3 sa nerozpadla)", async () => {
    const rows = await asAuthenticatedUser(managerEditUserId, (tx) => tx`SELECT id FROM users WHERE id = ${ownerUserId}`);
    expect(rows).toHaveLength(0);
  });

  it("manažér s edit_wages=true STÁLE nevie zmeniť VLASTNÉ manager_permissions (anti-eskalácia z Fázy 1 sa nerozpadla)", async () => {
    const result = await asAuthenticatedUser(managerEditUserId, (tx) => tx`UPDATE manager_permissions SET manage_accounts = true WHERE user_id = ${managerEditUserId} RETURNING user_id`);
    expect(result).toHaveLength(0);
  });

  it("manažér s edit_wages=true STÁLE nemá prístup do Nastavení bez vlastného balíčka (Fáza 2 sa nerozpadla)", async () => {
    await expect(
      asAuthenticatedUser(managerEditUserId, (tx) => tx`INSERT INTO positions (org_id, name) VALUES (${orgId}, 'Pokus cez edit_wages')`),
    ).rejects.toThrow();
  });
});

describe("Účtovníčka a owner — nezmenené správanie, bez ohľadu na has_manager_permission()", () => {
  it("účtovníčka VIDÍ sadzby aj plat VŽDY, bez ohľadu na balíčky (samostatná vetva v RLS, nie has_manager_permission)", async () => {
    const rates = await asAuthenticatedUser(accountantUserId, (tx) => tx`SELECT id FROM employee_rate_history WHERE employee_id = ${employeeId}`);
    expect(rates.length).toBeGreaterThan(0);
    const salaries = await asAuthenticatedUser(accountantUserId, (tx) => tx`SELECT id FROM employee_salary_history WHERE employee_id = ${employeeId}`);
    expect(salaries.length).toBeGreaterThan(0);
  });

  it("účtovníčka NEVIE zapisovať sadzby (write ostáva owner/edit_wages-manažér, accountant nikdy)", async () => {
    await expect(
      asAuthenticatedUser(
        accountantUserId,
        (tx) => tx`INSERT INTO employee_rate_history (employee_id, workplace_id, hourly_rate, valid_from) VALUES (${employeeId}, ${workplaceId}, 15, '2031-01-01')`,
      ),
    ).rejects.toThrow();
  });

  it("owner vidí aj zapisuje bez ohľadu na has_manager_permission()", async () => {
    // Ohraničený rozsah dávno PRED fixtúrou (1999) — nekoliduje so ŽIADNYM
    // iným riadkom bez ohľadu na poradie testov (EXCLUDE constraint je
    // dátová hygiena, nesúvisí s RLS, čo je jediné, čo tento test overuje).
    const inserted = await asAuthenticatedUser(
      ownerUserId,
      (tx) => tx`INSERT INTO employee_rate_history (employee_id, workplace_id, hourly_rate, valid_from, valid_to) VALUES (${employeeId}, ${workplaceId}, 16, '1999-01-01', '1999-12-31') RETURNING id`,
    );
    expect(inserted).toHaveLength(1);
  });
});

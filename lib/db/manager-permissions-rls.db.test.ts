import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { managerPermissions, organizations, users } from "./schema";
import { deleteOrgCascade } from "./test-fixture";

/**
 * Granulárne pravomoci manažérov, Fáza 1 — RLS testy pod Supabase built-in
 * rolou "authenticated" (rovnaký vzor a rovnaký dôvod ako
 * lib/db/rls-authenticated.test.ts — Supabase udeľuje plný CRUD grant
 * "authenticated" na KAŽDEJ tabuľke nezávisle od našich REVOKE pre app_user,
 * takže jediné, čo tu môže niečo zastaviť, je RLS politika samotná).
 *
 * Toto je JADRO bezpečnosti celej funkcie — dva samostatné, rovnako
 * kritické kontrakty:
 *
 * 1. "Žiadny riadok = dnešné manažérske práva" — has_manager_permission()
 *    MUSÍ vrátiť presne DEFAULT_MANAGER_PERMISSIONS (viewWages=true, zvyšok
 *    false) keď pre manažéra neexistuje riadok. Chyba tu by buď TICHO
 *    odobrala právo existujúcemu manažérovi (porušenie spätnej
 *    kompatibility), alebo ticho pridala právo navyše (diera).
 *
 * 2. ANTI-ESKALÁCIA — editovanie manager_permissions je RLS-vynútené
 *    owner-only, BEZ VÝNIMKY. Manažér (aj s manage_accounts=true) sa nesmie
 *    cez priamy SQL dostať k zápisu vlastného ani cudzieho riadku.
 */

const rawSql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function asAuthenticatedUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return rawSql.begin(async (tx) => {
    await tx`SET LOCAL ROLE authenticated`;
    await tx`SELECT set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function hasPerm(userId: string, perm: string): Promise<boolean> {
  return asAuthenticatedUser(userId, async (tx) => {
    const [row] = await tx`SELECT has_manager_permission(${perm}) AS result`;
    return row.result as boolean;
  });
}

let orgId: string;
let otherOrgId: string;
let ownerUserId: string;
let otherOrgOwnerUserId: string;
let managerNoRowUserId: string;
let managerWithRowUserId: string;
let managerOtherUserId: string; // druhý manažér v TEJ ISTEJ org — cieľ pokusov o cudziu úpravu
let employeeUserId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `manager-permissions RLS test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [otherOrg] = await adminDb.insert(organizations).values({ name: `manager-permissions RLS test — iná org ${crypto.randomUUID()}` }).returning();
  otherOrgId = otherOrg.id;

  const [owner, managerNoRow, managerWithRow, managerOther, employee] = await adminDb
    .insert(users)
    .values([
      { orgId, email: `owner-${crypto.randomUUID()}@mp-rls-test.local`, role: "owner", fullName: "Majiteľ" },
      { orgId, email: `mgr-norow-${crypto.randomUUID()}@mp-rls-test.local`, role: "manager", fullName: "Manažér bez riadku" },
      { orgId, email: `mgr-withrow-${crypto.randomUUID()}@mp-rls-test.local`, role: "manager", fullName: "Manažér s riadkom" },
      { orgId, email: `mgr-other-${crypto.randomUUID()}@mp-rls-test.local`, role: "manager", fullName: "Druhý manažér" },
      { orgId, email: `emp-${crypto.randomUUID()}@mp-rls-test.local`, role: "employee", fullName: "Zamestnanec" },
    ])
    .returning();
  ownerUserId = owner.id;
  managerNoRowUserId = managerNoRow.id;
  managerWithRowUserId = managerWithRow.id;
  managerOtherUserId = managerOther.id;
  employeeUserId = employee.id;

  const [otherOwner] = await adminDb
    .insert(users)
    .values({ orgId: otherOrgId, email: `owner-${crypto.randomUUID()}@mp-rls-test.local`, role: "owner", fullName: "Majiteľ inej organizácie" })
    .returning();
  otherOrgOwnerUserId = otherOwner.id;

  // managerWithRow má explicitný riadok — presne 1 balíček zapnutý
  // (manage_accounts), zvyšok false (vrátane view_wages — TESTUJE, že
  // explicitný riadok PREBIJE default, nielen dopĺňa).
  await adminDb.insert(managerPermissions).values({
    userId: managerWithRowUserId,
    manageAccounts: true,
    viewWages: false,
  });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
  await deleteOrgCascade(otherOrgId);
  await rawSql.end();
});

describe("has_manager_permission() — 'žiadny riadok = dnešné manažérske práva'", () => {
  it("owner má VŽDY všetko, bez ohľadu na perm názov (aj neexistujúci)", async () => {
    expect(await hasPerm(ownerUserId, "manage_accounts")).toBe(true);
    expect(await hasPerm(ownerUserId, "edit_wages")).toBe(true);
    expect(await hasPerm(ownerUserId, "view_wages")).toBe(true);
    expect(await hasPerm(ownerUserId, "nieco_co_neexistuje")).toBe(true);
  });

  it("manažér BEZ riadku — presne view_wages=true, zvyšných 5 balíčkov false (hardcoded default)", async () => {
    expect(await hasPerm(managerNoRowUserId, "view_wages")).toBe(true);
    expect(await hasPerm(managerNoRowUserId, "manage_positions_shifts")).toBe(false);
    expect(await hasPerm(managerNoRowUserId, "manage_rules")).toBe(false);
    expect(await hasPerm(managerNoRowUserId, "manage_accounts")).toBe(false);
    expect(await hasPerm(managerNoRowUserId, "edit_wages")).toBe(false);
    expect(await hasPerm(managerNoRowUserId, "manage_terminals")).toBe(false);
  });

  it("manažér S riadkom — explicitné hodnoty PREBÍJAJÚ default (view_wages=false napriek tomu, že default je true)", async () => {
    expect(await hasPerm(managerWithRowUserId, "manage_accounts")).toBe(true);
    expect(await hasPerm(managerWithRowUserId, "view_wages")).toBe(false);
    expect(await hasPerm(managerWithRowUserId, "manage_rules")).toBe(false);
  });

  it("employee/accountant — vždy false, aj pre view_wages", async () => {
    expect(await hasPerm(employeeUserId, "view_wages")).toBe(false);
    expect(await hasPerm(employeeUserId, "manage_accounts")).toBe(false);
  });
});

describe("manager_permissions RLS — SELECT", () => {
  it("owner vidí riadok manažéra VO SVOJEJ organizácii", async () => {
    const rows = await asAuthenticatedUser(ownerUserId, (tx) => tx`SELECT user_id FROM manager_permissions WHERE user_id = ${managerWithRowUserId}`);
    expect(rows).toHaveLength(1);
  });

  it("owner NEVIDÍ riadok manažéra v CUDZEJ organizácii (aj keby poznal jeho user_id)", async () => {
    const rows = await asAuthenticatedUser(otherOrgOwnerUserId, (tx) => tx`SELECT user_id FROM manager_permissions WHERE user_id = ${managerWithRowUserId}`);
    expect(rows).toHaveLength(0);
  });

  it("manažér vidí VLASTNÝ riadok", async () => {
    const rows = await asAuthenticatedUser(managerWithRowUserId, (tx) => tx`SELECT user_id FROM manager_permissions WHERE user_id = ${managerWithRowUserId}`);
    expect(rows).toHaveLength(1);
  });

  it("manažér NEVIDÍ CUDZÍ riadok (iný manažér v tej istej organizácii)", async () => {
    const rows = await asAuthenticatedUser(managerOtherUserId, (tx) => tx`SELECT user_id FROM manager_permissions WHERE user_id = ${managerWithRowUserId}`);
    expect(rows).toHaveLength(0);
  });
});

describe("manager_permissions RLS — ANTI-ESKALÁCIA (zápis výhradne owner)", () => {
  it("manažér NEVIE vytvoriť VLASTNÝ riadok (INSERT zamietnutý RLS)", async () => {
    await expect(
      asAuthenticatedUser(managerNoRowUserId, (tx) => tx`INSERT INTO manager_permissions (user_id, edit_wages) VALUES (${managerNoRowUserId}, true)`),
    ).rejects.toThrow();

    const check = await adminDb.select().from(managerPermissions).where(eq(managerPermissions.userId, managerNoRowUserId));
    expect(check).toHaveLength(0);
  });

  it("manažér s manage_accounts=true NEVIE zmeniť VLASTNÉ pravomoci (UPDATE neovplyvní žiadny riadok — nie chyba, RLS filter)", async () => {
    const result = await asAuthenticatedUser(managerWithRowUserId, (tx) => tx`UPDATE manager_permissions SET edit_wages = true WHERE user_id = ${managerWithRowUserId} RETURNING user_id`);
    expect(result).toHaveLength(0);

    const [unchanged] = await adminDb.select().from(managerPermissions).where(eq(managerPermissions.userId, managerWithRowUserId));
    expect(unchanged.editWages).toBe(false);
  });

  it("manažér NEVIE zmeniť CUDZIE pravomoci (iný manažér v tej istej organizácii)", async () => {
    const result = await asAuthenticatedUser(managerWithRowUserId, (tx) => tx`UPDATE manager_permissions SET manage_accounts = true WHERE user_id = ${managerNoRowUserId} RETURNING user_id`);
    expect(result).toHaveLength(0);
  });

  it("manažér NEVIE zmazať VLASTNÝ ani CUDZÍ riadok", async () => {
    const own = await asAuthenticatedUser(managerWithRowUserId, (tx) => tx`DELETE FROM manager_permissions WHERE user_id = ${managerWithRowUserId} RETURNING user_id`);
    expect(own).toHaveLength(0);
    const [stillThere] = await adminDb.select().from(managerPermissions).where(eq(managerPermissions.userId, managerWithRowUserId));
    expect(stillThere).toBeDefined();
  });

  it("owner VIE vytvoriť/zmeniť riadok manažéra VO SVOJEJ organizácii", async () => {
    const inserted = await asAuthenticatedUser(ownerUserId, (tx) => tx`INSERT INTO manager_permissions (user_id, manage_rules) VALUES (${managerNoRowUserId}, true) RETURNING user_id`);
    expect(inserted).toHaveLength(1);

    const updated = await asAuthenticatedUser(ownerUserId, (tx) => tx`UPDATE manager_permissions SET manage_rules = false WHERE user_id = ${managerNoRowUserId} RETURNING manage_rules`);
    expect(updated).toHaveLength(1);
    expect(updated[0].manage_rules).toBe(false);
  });

  it("owner NEVIE vytvoriť riadok pre manažéra v CUDZEJ organizácii", async () => {
    await expect(
      asAuthenticatedUser(otherOrgOwnerUserId, (tx) => tx`INSERT INTO manager_permissions (user_id, manage_accounts) VALUES (${managerOtherUserId}, true)`),
    ).rejects.toThrow();
  });

  it("owner NEVIE vytvoriť riadok pre NEmanažéra (dátová hygiena — u.role='manager' vynútené v WITH CHECK)", async () => {
    await expect(asAuthenticatedUser(ownerUserId, (tx) => tx`INSERT INTO manager_permissions (user_id, manage_accounts) VALUES (${employeeUserId}, true)`)).rejects.toThrow();
  });
});

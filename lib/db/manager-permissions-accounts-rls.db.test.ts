import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { managerPermissions, organizations, users } from "./schema";
import { deleteOrgCascade } from "./test-fixture";

/**
 * Granulárne pravomoci manažérov, Fáza 3 (Správa kont) — NAJCITLIVEJŠIA
 * fáza. RLS testy pod "authenticated" (rovnaký vzor ako predošlé dva
 * súbory). Toto je JADRO overenia: manage_accounts smie presne to, čo bolo
 * zadané — nič viac, nikdy owner, nikdy cudzie pravomoci.
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
let ownerUserId: string;
let managerNoAccountsUserId: string; // baseline manažér — žiadny balíček, /pozvat musí zostať nedotknuté
let managerWithAccountsUserId: string;
let peerManagerUserId: string; // iný manažér VLASTNEJ organizácie — cieľ pokusu o cudzie manager_permissions
let employeeUserId: string;
let otherOrgManagerWithAccountsUserId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `mp-accounts-rls test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [otherOrg] = await adminDb.insert(organizations).values({ name: `mp-accounts-rls test — iná org ${crypto.randomUUID()}` }).returning();
  otherOrgId = otherOrg.id;

  const [owner, managerNoAccounts, managerWithAccounts, peerManager, employee] = await adminDb
    .insert(users)
    .values([
      { orgId, email: `owner-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "owner", fullName: "Majiteľ" },
      { orgId, email: `mgr-noacc-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "manager", fullName: "Manažér bez Kontá" },
      { orgId, email: `mgr-withacc-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "manager", fullName: "Manažér s Kontá" },
      { orgId, email: `mgr-peer-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "manager", fullName: "Kolega Manažér" },
      { orgId, email: `emp-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "employee", fullName: "Zamestnankyňa", isActive: true },
    ])
    .returning();
  ownerUserId = owner.id;
  managerNoAccountsUserId = managerNoAccounts.id;
  managerWithAccountsUserId = managerWithAccounts.id;
  peerManagerUserId = peerManager.id;
  employeeUserId = employee.id;

  const [, otherManager] = await adminDb
    .insert(users)
    .values([
      { orgId: otherOrgId, email: `owner-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "owner", fullName: "Majiteľ inej org" },
      { orgId: otherOrgId, email: `mgr-${crypto.randomUUID()}@mp-accounts-rls.local`, role: "manager", fullName: "Manažér inej org" },
    ])
    .returning();
  otherOrgManagerWithAccountsUserId = otherManager.id;

  await adminDb.insert(managerPermissions).values({ userId: managerWithAccountsUserId, manageAccounts: true });
  await adminDb.insert(managerPermissions).values({ userId: otherOrgManagerWithAccountsUserId, manageAccounts: true });
  // peerManager má VLASTNÝ riadok s inými balíčkami — cieľ pokusu managerWithAccounts o rozšírenie cudzích práv.
  await adminDb.insert(managerPermissions).values({ userId: peerManagerUserId, manageRules: false });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
  await deleteOrgCascade(otherOrgId);
  await rawSql.end();
});

describe("KRITICKÉ — manage_accounts nikdy nedovolí vytvoriť/povýšiť na 'owner'", () => {
  it("manažér s manage_accounts=true NEVIE vytvoriť role='owner' riadok (INSERT zamietnutý RLS)", async () => {
    await expect(
      asAuthenticatedUser(
        managerWithAccountsUserId,
        (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${orgId}, ${"pokus-owner-" + crypto.randomUUID() + "@x.local"}, 'owner', 'Pokus o ownera')`,
      ),
    ).rejects.toThrow();
  });

  // RLS UPDATE má dva rôzne prejavy zamietnutia — dôležité rozlišovať:
  // (1) row-level USING nesedí VÔBEC → riadok sa tichoo "nenájde", 0 riadkov,
  //     žiadna chyba (presne prípad "iný manažér" nižšie — role='manager'
  //     nesedí s users_update_manage_accounts, self-update nesedí, owner-only
  //     nesedí → žiadna UPDATE politika sa vôbec nechytí).
  // (2) USING sedí (self-update pre vlastný riadok, manage_accounts pre
  //     zamestnanecký cieľ), ale WITH CHECK na VÝSLEDNÝ riadok zlyhá (rola sa
  //     zmenila na 'owner') → Postgres CELÝ príkaz ZAMIETNE chybou, nie
  //     tichým 0-riadkovým výsledkom. Oba prejavy sú rovnako platný dôkaz
  //     zamietnutia — len iný tvar.
  it("manažér s manage_accounts=true NEVIE povýšiť SEBA na owner (USING sedí cez self-update, WITH CHECK zamietne CELÝ príkaz)", async () => {
    await expect(asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET role = 'owner' WHERE id = ${managerWithAccountsUserId}`)).rejects.toThrow();
    const [unchanged] = await adminDb.select({ role: users.role }).from(users).where(eq(users.id, managerWithAccountsUserId));
    expect(unchanged.role).toBe("manager");
  });

  it("manažér s manage_accounts=true NEVIE povýšiť INÉHO manažéra na owner (USING nesedí vôbec — cieľ nie je 'employee' — tichý 0-riadkový výsledok)", async () => {
    const result = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET role = 'owner' WHERE id = ${peerManagerUserId} RETURNING id`);
    expect(result).toHaveLength(0);
    const [unchanged] = await adminDb.select({ role: users.role }).from(users).where(eq(users.id, peerManagerUserId));
    expect(unchanged.role).toBe("manager");
  });

  it("manažér s manage_accounts=true NEVIE povýšiť zamestnanca na owner (USING sedí cez users_update_manage_accounts, WITH CHECK zamietne CELÝ príkaz)", async () => {
    await expect(asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET role = 'owner' WHERE id = ${employeeUserId}`)).rejects.toThrow();
    const [unchanged] = await adminDb.select({ role: users.role }).from(users).where(eq(users.id, employeeUserId));
    expect(unchanged.role).toBe("employee");
  });
});

describe("KRITICKÉ — cudzie manager_permissions ostávajú nedotknuteľné, aj s balíčkom Kontá (potvrdenie z Fázy 1)", () => {
  it("manažér s manage_accounts=true NEVIE zmeniť pravomoci INÉHO manažéra (UPDATE zamietnutý RLS)", async () => {
    const result = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE manager_permissions SET manage_rules = true WHERE user_id = ${peerManagerUserId} RETURNING user_id`);
    expect(result).toHaveLength(0);
    const [unchanged] = await adminDb.select({ manageRules: managerPermissions.manageRules }).from(managerPermissions).where(eq(managerPermissions.userId, peerManagerUserId));
    expect(unchanged.manageRules).toBe(false);
  });

  it("manažér s manage_accounts=true NEVIE rozšíriť VLASTNÉ pravomoci (UPDATE zamietnutý RLS)", async () => {
    const result = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE manager_permissions SET edit_wages = true WHERE user_id = ${managerWithAccountsUserId} RETURNING user_id`);
    expect(result).toHaveLength(0);
  });

  it("manažér s manage_accounts=true NEVIE vytvoriť manager_permissions riadok pre novovytvorené konto (zápis ostáva výhradne owner)", async () => {
    // Simuluje pokus manažéra rovno pri vytváraní konta nastaviť si preň pravomoci.
    await expect(
      asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`INSERT INTO manager_permissions (user_id, manage_accounts) VALUES (${employeeUserId}, true)`),
    ).rejects.toThrow();
  });
});

describe("KRITICKÉ — majiteľské kontá sú nedotknuteľné (mazanie/deaktivácia) AJ neviditeľné", () => {
  it("manažér s manage_accounts=true NEVIE deaktivovať majiteľa (UPDATE is_active zamietnutý RLS)", async () => {
    const result = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET is_active = false WHERE id = ${ownerUserId} RETURNING id`);
    expect(result).toHaveLength(0);
    const [unchanged] = await adminDb.select({ isActive: users.isActive }).from(users).where(eq(users.id, ownerUserId));
    expect(unchanged.isActive).toBe(true);
  });

  it("manažér s manage_accounts=true NEVIDÍ majiteľské konto vôbec (SELECT vráti 0 riadkov, nie len 'nesmie písať')", async () => {
    const rows = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`SELECT id FROM users WHERE id = ${ownerUserId}`);
    expect(rows).toHaveLength(0);
  });

  it("manažér s manage_accounts=true NEVIE zmazať (soft-delete cez deleted_at) majiteľa", async () => {
    const result = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET deleted_at = now(), auth_user_id = NULL, email = NULL WHERE id = ${ownerUserId} RETURNING id`);
    expect(result).toHaveLength(0);
  });
});

describe("KRITICKÉ — cross-org izolácia platí aj s manage_accounts=true", () => {
  it("manažér s manage_accounts=true (v Org A) NEVIE vytvoriť konto v CUDZEJ organizácii", async () => {
    await expect(
      asAuthenticatedUser(
        managerWithAccountsUserId,
        (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${otherOrgId}, ${"pokus-cudzia-org-" + crypto.randomUUID() + "@x.local"}, 'manager', 'Pokus cez cudziu org')`,
      ),
    ).rejects.toThrow();
  });

  it("manažér s manage_accounts=true (v inej org) NEVIDÍ zamestnanca org A", async () => {
    const rows = await asAuthenticatedUser(otherOrgManagerWithAccountsUserId, (tx) => tx`SELECT id FROM users WHERE id = ${employeeUserId}`);
    expect(rows).toHaveLength(0);
  });
});

describe("Čo manažér s manage_accounts=true SKUTOČNE smie", () => {
  it("VIE vytvoriť konto s rolou 'manager' vo VLASTNEJ organizácii", async () => {
    const email = `novy-manager-${crypto.randomUUID()}@mp-accounts-rls.local`;
    const inserted = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${orgId}, ${email}, 'manager', 'Nový Manažér') RETURNING id`);
    expect(inserted).toHaveLength(1);
  });

  it("VIE vytvoriť konto s rolou 'accountant' vo VLASTNEJ organizácii", async () => {
    const email = `nova-uctovnicka-${crypto.randomUUID()}@mp-accounts-rls.local`;
    const inserted = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${orgId}, ${email}, 'accountant', 'Nová Účtovníčka') RETURNING id`);
    expect(inserted).toHaveLength(1);
  });

  it("VIE deaktivovať a znova aktivovať zamestnanecké konto", async () => {
    const deactivated = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET is_active = false WHERE id = ${employeeUserId} RETURNING is_active`);
    expect(deactivated).toHaveLength(1);
    expect(deactivated[0].is_active).toBe(false);

    const reactivated = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`UPDATE users SET is_active = true WHERE id = ${employeeUserId} RETURNING is_active`);
    expect(reactivated[0].is_active).toBe(true);
  });

  it("VIDÍ manager/accountant/employee kontá VLASTNEJ organizácie (org-široko, nie len vlastné prevádzky)", async () => {
    const rows = await asAuthenticatedUser(managerWithAccountsUserId, (tx) => tx`SELECT role FROM users WHERE org_id = ${orgId} AND deleted_at IS NULL`);
    const roles = rows.map((r) => r.role).sort();
    expect(roles).not.toContain("owner");
    expect(roles).toContain("manager");
    expect(roles).toContain("employee");
  });
});

describe("/pozvat (pozvanie zamestnanca) ostáva ÚPLNE MIMO — nedotknuté, funguje aj BEZ manage_accounts", () => {
  it("manažér BEZ manage_accounts VIE vytvoriť role='employee' riadok (users_insert_manager, pôvodná vetva)", async () => {
    // ZÁMERNE bez RETURNING — manažér (na rozdiel od ownera) nevidí NOVÝ
    // riadok cez RLS SELECT skôr, než vznikne väzba employees.user_id
    // (users_select_manager to vyžaduje) — presne ten istý dôvod, prečo boli
    // opravené createEmployeeAccountAndInvite/WithPassword (odstránené
    // .returning(), Fáza 3 — objavený predchádzajúci bug). Táto RAW SQL
    // vetva overuje len samotný INSERT WITH CHECK, nie viditeľnosť.
    const email = `pozvat-baseline-${crypto.randomUUID()}@mp-accounts-rls.local`;
    await asAuthenticatedUser(managerNoAccountsUserId, (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${orgId}, ${email}, 'employee', 'Pozvaný Zamestnanec')`);
    const [row] = await adminDb.select({ role: users.role }).from(users).where(eq(users.email, email));
    expect(row?.role).toBe("employee");
  });

  it("manažér BEZ manage_accounts NEVIE vytvoriť role='manager' ani 'accountant' (nová vetva vyžaduje balíček)", async () => {
    await expect(
      asAuthenticatedUser(
        managerNoAccountsUserId,
        (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${orgId}, ${"pokus-manager-" + crypto.randomUUID() + "@x.local"}, 'manager', 'Pokus bez balíčka')`,
      ),
    ).rejects.toThrow();
  });

  it("manažér BEZ manage_accounts NEVIE deaktivovať zamestnanca (users_update_manage_accounts vyžaduje balíček)", async () => {
    const result = await asAuthenticatedUser(managerNoAccountsUserId, (tx) => tx`UPDATE users SET is_active = false WHERE id = ${employeeUserId} RETURNING id`);
    expect(result).toHaveLength(0);
  });
});

describe("owner — nezmenené správanie, bez ohľadu na has_manager_permission()", () => {
  it("owner VIE vytvoriť owner/manager/accountant konto a deaktivovať kohokoľvek (okrem seba, to rieši appka)", async () => {
    const ownerAcc = await asAuthenticatedUser(ownerUserId, (tx) => tx`INSERT INTO users (org_id, email, role, full_name) VALUES (${orgId}, ${"owner2-" + crypto.randomUUID() + "@x.local"}, 'owner', 'Druhý Majiteľ') RETURNING id`);
    expect(ownerAcc).toHaveLength(1);

    const deactivated = await asAuthenticatedUser(ownerUserId, (tx) => tx`UPDATE users SET is_active = false WHERE id = ${managerNoAccountsUserId} RETURNING is_active`);
    expect(deactivated[0].is_active).toBe(false);
    await adminDb.update(users).set({ isActive: true }).where(eq(users.id, managerNoAccountsUserId));
  });
});

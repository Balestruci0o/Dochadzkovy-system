import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "./admin";
import { holidays, legalRules, managerPermissions, organizations, positions, terminals, users, workplaces } from "./schema";
import { deleteOrgCascade } from "./test-fixture";

/**
 * Granulárne pravomoci manažérov, Fáza 2 (Nastavenia) — RLS testy pod
 * "authenticated" (rovnaký vzor ako lib/db/rls-authenticated.test.ts a
 * lib/db/manager-permissions-rls.test.ts). Overuje presne to, čo bolo
 * zadané ako kritické: KAŽDÝ balíček sa dá obísť len cez RLS zamietnutie
 * priamym SQL pokusom, nie len skrytím tlačidla v appke.
 *
 * Pokrýva 6 politík zmenených v migrácii 0048 (positions_write,
 * shift_templates_write, legal_rules_write, coverage_requirements_write,
 * workplace_closures_write, terminals_write) — reprezentatívne cez 3
 * balíčky (managePositionsShifts na positions, manageRules na legal_rules,
 * manageTerminals na terminals) + org-hranicu + potvrdenie, že `holidays`
 * (sviatky) OSTÁVA is_owner()-only bez ohľadu na akýkoľvek balíček.
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
let otherOrgWorkplaceId: string;
let ownerUserId: string;
let managerNoPermUserId: string;
let managerWithPermUserId: string; // manage_positions_shifts + manage_rules + manage_terminals všetky true
let otherOrgManagerUserId: string;
let otherOrgOwnerUserId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `mp-settings-rls test ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [otherOrg] = await adminDb.insert(organizations).values({ name: `mp-settings-rls test — iná org ${crypto.randomUUID()}` }).returning();
  otherOrgId = otherOrg.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  workplaceId = wp.id;
  const [otherWp] = await adminDb.insert(workplaces).values({ orgId: otherOrgId, name: "Hotel iná org", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
  otherOrgWorkplaceId = otherWp.id;

  const [owner, managerNoPerm, managerWithPerm] = await adminDb
    .insert(users)
    .values([
      { orgId, email: `owner-${crypto.randomUUID()}@mp-settings-rls.local`, role: "owner", fullName: "Majiteľ" },
      { orgId, email: `mgr-noperm-${crypto.randomUUID()}@mp-settings-rls.local`, role: "manager", fullName: "Manažér bez pravomocí" },
      { orgId, email: `mgr-withperm-${crypto.randomUUID()}@mp-settings-rls.local`, role: "manager", fullName: "Manažér s pravomocami" },
    ])
    .returning();
  ownerUserId = owner.id;
  managerNoPermUserId = managerNoPerm.id;
  managerWithPermUserId = managerWithPerm.id;

  const [otherOwner, otherManager] = await adminDb
    .insert(users)
    .values([
      { orgId: otherOrgId, email: `owner-${crypto.randomUUID()}@mp-settings-rls.local`, role: "owner", fullName: "Majiteľ inej org" },
      { orgId: otherOrgId, email: `mgr-${crypto.randomUUID()}@mp-settings-rls.local`, role: "manager", fullName: "Manažér inej org" },
    ])
    .returning();
  otherOrgOwnerUserId = otherOwner.id;
  otherOrgManagerUserId = otherManager.id;

  await adminDb.insert(managerPermissions).values({
    userId: managerWithPermUserId,
    managePositionsShifts: true,
    manageRules: true,
    manageTerminals: true,
  });
  // otherOrgManager má TIEŽ všetko true — použije sa na dôkaz, že org-hranica
  // drží NEZÁVISLE od balíčka (nie je to len "žiadny riadok = false").
  await adminDb.insert(managerPermissions).values({
    userId: otherOrgManagerUserId,
    managePositionsShifts: true,
    manageRules: true,
    manageTerminals: true,
  });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
  await deleteOrgCascade(otherOrgId);
  await rawSql.end();
});

describe("positions_write — manage_positions_shifts", () => {
  it("manažér BEZ pravomoci NEVIE vytvoriť pozíciu (INSERT zamietnutý RLS)", async () => {
    await expect(
      asAuthenticatedUser(managerNoPermUserId, (tx) => tx`INSERT INTO positions (org_id, name) VALUES (${orgId}, 'Recepcia — pokus bez pravomoci')`),
    ).rejects.toThrow();
    const rows = await adminDb.select().from(positions).where(eq(positions.orgId, orgId));
    expect(rows.some((r) => r.name === "Recepcia — pokus bez pravomoci")).toBe(false);
  });

  it("manažér S pravomocou VIE vytvoriť/upraviť/zmazať pozíciu vo VLASTNEJ organizácii", async () => {
    const inserted = await asAuthenticatedUser(managerWithPermUserId, (tx) => tx`INSERT INTO positions (org_id, name) VALUES (${orgId}, 'Recepcia') RETURNING id`);
    expect(inserted).toHaveLength(1);
    const id = inserted[0].id as string;

    const updated = await asAuthenticatedUser(managerWithPermUserId, (tx) => tx`UPDATE positions SET name = 'Recepcia (upravené)' WHERE id = ${id} RETURNING name`);
    expect(updated[0].name).toBe("Recepcia (upravené)");

    const deleted = await asAuthenticatedUser(managerWithPermUserId, (tx) => tx`DELETE FROM positions WHERE id = ${id} RETURNING id`);
    expect(deleted).toHaveLength(1);
  });

  it("manažér S pravomocou (aj keď má všetko true) NEVIE zapisovať pozície CUDZEJ organizácie — org-hranica drží nezávisle od balíčka", async () => {
    await expect(
      asAuthenticatedUser(otherOrgManagerUserId, (tx) => tx`INSERT INTO positions (org_id, name) VALUES (${orgId}, 'Pokus cez cudziu org')`),
    ).rejects.toThrow();
  });
});

describe("legal_rules_write — manage_rules", () => {
  it("manažér BEZ pravomoci NEVIE vytvoriť §ZP pravidlo", async () => {
    await expect(
      asAuthenticatedUser(managerNoPermUserId, (tx) => tx`INSERT INTO legal_rules (org_id, code, name, params) VALUES (${orgId}, 'TEST_RULE', 'Test', '{"x":1}'::jsonb)`),
    ).rejects.toThrow();
  });

  it("manažér S pravomocou VIE vytvoriť/upraviť §ZP pravidlo vo VLASTNEJ organizácii", async () => {
    const inserted = await asAuthenticatedUser(
      managerWithPermUserId,
      (tx) => tx`INSERT INTO legal_rules (org_id, code, name, params) VALUES (${orgId}, 'TEST_RULE', 'Test', '{"x":1}'::jsonb) RETURNING id`,
    );
    expect(inserted).toHaveLength(1);
    const updated = await asAuthenticatedUser(managerWithPermUserId, (tx) => tx`UPDATE legal_rules SET is_hard = false WHERE id = ${inserted[0].id} RETURNING is_hard`);
    expect(updated[0].is_hard).toBe(false);
  });

  it("§ZP pravidlo reálne existuje v DB (nie len že SQL prešlo)", async () => {
    const rows = await adminDb.select().from(legalRules).where(eq(legalRules.orgId, orgId));
    expect(rows.some((r) => r.code === "TEST_RULE")).toBe(true);
  });
});

describe("terminals — manage_terminals (predtým NULOVÝ manažérsky prístup, ani SELECT)", () => {
  it("manažér BEZ pravomoci NEVIDÍ ANI JEDEN terminál (SELECT vráti 0 riadkov, nie chybu)", async () => {
    await adminDb.insert(terminals).values({ workplaceId, name: "Recepcia terminál", deviceId: `mp-settings-rls-${crypto.randomUUID()}`, secretHash: "test-hash" });
    const rows = await asAuthenticatedUser(managerNoPermUserId, (tx) => tx`SELECT id FROM terminals WHERE workplace_id = ${workplaceId}`);
    expect(rows).toHaveLength(0);
  });

  it("manažér S pravomocou VIDÍ a VIE spravovať terminál vo VLASTNEJ organizácii", async () => {
    const rows = await asAuthenticatedUser(managerWithPermUserId, (tx) => tx`SELECT id FROM terminals WHERE workplace_id = ${workplaceId}`);
    expect(rows.length).toBeGreaterThan(0);

    const inserted = await asAuthenticatedUser(
      managerWithPermUserId,
      (tx) => tx`INSERT INTO terminals (workplace_id, name, device_id, secret_hash) VALUES (${workplaceId}, 'Nový terminál', ${"mp-settings-rls-2-" + crypto.randomUUID()}, 'hash') RETURNING id`,
    );
    expect(inserted).toHaveLength(1);
  });

  it("manažér (aj s pravomocou) NEVIDÍ terminál CUDZEJ organizácie", async () => {
    await adminDb.insert(terminals).values({ workplaceId: otherOrgWorkplaceId, name: "Cudzí terminál", deviceId: `mp-settings-rls-other-${crypto.randomUUID()}`, secretHash: "test-hash" });
    const rows = await asAuthenticatedUser(managerWithPermUserId, (tx) => tx`SELECT id FROM terminals WHERE workplace_id = ${otherOrgWorkplaceId}`);
    expect(rows).toHaveLength(0);
  });
});

describe("holidays (sviatky) — OSTÁVA is_owner()-only, ŽIADNY balíček ho neodomkne", () => {
  it("manažér s manage_rules=true (aj keby si myslel, že 'sviatky' patrí pod pravidlá) NEVIE zapísať sviatok", async () => {
    await expect(
      asAuthenticatedUser(managerWithPermUserId, (tx) => tx`INSERT INTO holidays (date, name) VALUES ('2030-01-01', 'Pokus manažéra')`),
    ).rejects.toThrow();
    const [row] = await adminDb.select().from(holidays).where(eq(holidays.date, "2030-01-01"));
    expect(row).toBeUndefined();
  });

  it("owner VIE zapísať sviatok (nezmenené správanie)", async () => {
    const inserted = await asAuthenticatedUser(ownerUserId, (tx) => tx`INSERT INTO holidays (date, name) VALUES ('2030-01-02', 'Test sviatok') RETURNING date`);
    expect(inserted).toHaveLength(1);
    await adminDb.delete(holidays).where(eq(holidays.date, "2030-01-02"));
  });
});

describe("owner — nezmenené správanie (bit-for-bit), bez ohľadu na has_manager_permission()", () => {
  it("owner VIE zapisovať positions/legal_rules/terminals presne ako predtým", async () => {
    const pos = await asAuthenticatedUser(ownerUserId, (tx) => tx`INSERT INTO positions (org_id, name) VALUES (${orgId}, 'Owner pozícia') RETURNING id`);
    expect(pos).toHaveLength(1);
    const rule = await asAuthenticatedUser(ownerUserId, (tx) => tx`INSERT INTO legal_rules (org_id, code, name, params) VALUES (${orgId}, 'OWNER_RULE', 'Test', '{"x":1}'::jsonb) RETURNING id`);
    expect(rule).toHaveLength(1);
    const term = await asAuthenticatedUser(
      ownerUserId,
      (tx) => tx`INSERT INTO terminals (workplace_id, name, device_id, secret_hash) VALUES (${workplaceId}, 'Owner terminál', ${"mp-settings-rls-owner-" + crypto.randomUUID()}, 'hash') RETURNING id`,
    );
    expect(term).toHaveLength(1);
  });

  it("owner NEVIE zapisovať do CUDZEJ organizácie (org-hranica platí aj preň)", async () => {
    await expect(asAuthenticatedUser(otherOrgOwnerUserId, (tx) => tx`INSERT INTO positions (org_id, name) VALUES (${orgId}, 'Pokus cudzieho ownera')`)).rejects.toThrow();
  });
});

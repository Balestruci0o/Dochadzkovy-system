import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { withUserContext } from "@/lib/db";
import { adminDb } from "@/lib/db/admin";
import { auditLog, employees, managerWorkplaces, organizations, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { checkAccountDeletable, deleteUserAccount } from "./delete-account";

/**
 * Nastavenia → Kontá, zmazanie PRIHLASOVACIEHO konta (soft-delete). Kľúčové
 * správanie na overenie: (1) owner sa nezmaže sám seba, (2) v organizácii
 * ostane vždy aspoň jeden AKTÍVNY owner (neaktívny/soft-deleted sa nepočíta),
 * (3) samotné mazanie je soft-delete (users riadok OSTÁVA, len sa mu vynuluje
 * prihlasovacia identita), (4) `employees.user_id`/`manager_workplaces` sa
 * odpoja, (5) Supabase Auth účet sa fyzicky zmaže, (6) audit log zaznamená
 * PRESNE túto zmenu, nič viac (nie bežné prihlásenie).
 *
 * KAŽDÝ test má VLASTNÚ organizáciu (nie zdieľanú `testOrg()`) — testy tu
 * overujú "koľko ownerov MÁ organizácia", takže by sa navzájom kazili, keby
 * si owner-riadky z predošlých testov ostali v tej istej org.
 */

const createdOrgIds: string[] = [];
const createdAuthUserIds: string[] = [];

async function newOrg(): Promise<string> {
  const [org] = await adminDb.insert(organizations).values({ name: `delete-account-test ${crypto.randomUUID()}` }).returning();
  createdOrgIds.push(org.id);
  return org.id;
}

async function newUser(orgId: string, overrides: Partial<typeof users.$inferInsert> & { role: "owner" | "manager" | "employee" | "accountant" }) {
  const [row] = await adminDb
    .insert(users)
    .values({
      orgId,
      email: `delacc-${crypto.randomUUID()}@test.local`,
      fullName: "Test Konto",
      isActive: true,
      ...overrides,
    })
    .returning();
  return row;
}

async function newUserWithRealAuth(orgId: string, role: "owner" | "manager" | "employee" | "accountant") {
  const admin = createSupabaseAdminClient();
  const email = `delacc-real-${crypto.randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`Príprava testu zlyhala: ${error?.message}`);
  createdAuthUserIds.push(data.user.id);
  return newUser(orgId, { role, email, authUserId: data.user.id, activatedAt: new Date() });
}

afterEach(async () => {
  const admin = createSupabaseAdminClient();
  while (createdAuthUserIds.length > 0) {
    const id = createdAuthUserIds.pop()!;
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  while (createdOrgIds.length > 0) {
    const id = createdOrgIds.pop()!;
    await deleteOrgCascade(id);
  }
});

describe("checkAccountDeletable", () => {
  it("owner nesmie zmazať sám seba", async () => {
    const orgId = await newOrg();
    const owner = await newUser(orgId, { role: "owner" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, owner.id, owner.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("svoje vlastné konto");
  });

  it("zamietne zmazanie POSLEDNÉHO aktívneho ownera", async () => {
    const orgId = await newOrg();
    const onlyOwner = await newUser(orgId, { role: "owner" });
    const someoneElse = await newUser(orgId, { role: "manager" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, someoneElse.id, onlyOwner.id));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("posledný aktívny majiteľ");
  });

  it("iný AKTÍVNY owner v organizácii existuje → zmazanie prvého je OK", async () => {
    const orgId = await newOrg();
    const owner1 = await newUser(orgId, { role: "owner" });
    const owner2 = await newUser(orgId, { role: "owner" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, owner2.id, owner1.id));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.target.id).toBe(owner1.id);
  });

  it("NEAKTÍVNY owner sa nepočíta ako 'aktívny' — zmazanie jediného aktívneho ownera je stále zamietnuté", async () => {
    const orgId = await newOrg();
    const activeOwner = await newUser(orgId, { role: "owner" });
    await newUser(orgId, { role: "owner", isActive: false });
    const someoneElse = await newUser(orgId, { role: "manager" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, someoneElse.id, activeOwner.id));
    expect(result.ok).toBe(false);
  });

  it("už SOFT-DELETED owner sa nepočíta ako 'aktívny'", async () => {
    const orgId = await newOrg();
    const activeOwner = await newUser(orgId, { role: "owner" });
    await newUser(orgId, { role: "owner", deletedAt: new Date(), isActive: false, email: null });
    const someoneElse = await newUser(orgId, { role: "manager" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, someoneElse.id, activeOwner.id));
    expect(result.ok).toBe(false);
  });

  it("cieľové konto neexistuje / je už zmazané → čitateľná chyba", async () => {
    const orgId = await newOrg();
    const someoneElse = await newUser(orgId, { role: "manager" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, someoneElse.id, crypto.randomUUID()));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("neexistuje");
  });

  it("mazanie manažéra/zamestnanca NEKONTROLUJE počet ownerov vôbec", async () => {
    const orgId = await newOrg();
    const onlyOwner = await newUser(orgId, { role: "owner" });
    const manager = await newUser(orgId, { role: "manager" });
    const result = await adminDb.transaction((tx) => checkAccountDeletable(tx, onlyOwner.id, manager.id));
    expect(result.ok).toBe(true);
  });
});

describe("deleteUserAccount", () => {
  it("soft-deletes users riadok, odpojí employees.user_id, zmaže manager_workplaces, a fyzicky zmaže Supabase Auth účet", async () => {
    const orgId = await newOrg();
    const owner = await newUser(orgId, { role: "owner" });
    const manager = await newUserWithRealAuth(orgId, "manager");
    const [wp] = await adminDb
      .insert(workplaces)
      .values({ orgId, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    await adminDb.insert(managerWorkplaces).values({ userId: manager.id, workplaceId: wp.id });
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, userId: manager.id, firstName: "Test", lastName: "Zamestnanec", hiredOn: "2024-01-01" })
      .returning();

    const outcome = await withUserContext(owner.id, (tx) => deleteUserAccount(tx, owner.id, manager.id));
    expect(outcome.ok).toBe(true);

    const [userAfter] = await adminDb.select().from(users).where(eq(users.id, manager.id));
    expect(userAfter.authUserId).toBeNull();
    expect(userAfter.email).toBeNull();
    expect(userAfter.isActive).toBe(false);
    expect(userAfter.deletedAt).not.toBeNull();
    expect(userAfter.fullName).toBe(manager.fullName); // história ostáva čitateľná

    const [employeeAfter] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(employeeAfter.userId).toBeNull();

    const remainingManagerWorkplaces = await adminDb.select().from(managerWorkplaces).where(eq(managerWorkplaces.userId, manager.id));
    expect(remainingManagerWorkplaces).toHaveLength(0);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(manager.authUserId!);
    expect(data.user ?? null).toBeNull();
    expect(error).not.toBeNull();

    // authUserId je teraz vymazaný, netreba ho čistiť v afterEach
    const idx = createdAuthUserIds.indexOf(manager.authUserId!);
    if (idx >= 0) createdAuthUserIds.splice(idx, 1);
  });

  it("zapíše presne jeden audit_log záznam (kto/kedy/koho), ale bežné prihlásenie (last_login_at) audit nespustí", async () => {
    const orgId = await newOrg();
    const owner = await newUser(orgId, { role: "owner" });
    const target = await newUser(orgId, { role: "manager" });

    // Simuluje bežné prihlásenie — dotýka sa len last_login_at, NEMÁ vytvoriť audit riadok.
    await withUserContext(owner.id, (tx) => tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, target.id)));

    const beforeDelete = await adminDb.select().from(auditLog).where(and(eq(auditLog.tableName, "users"), eq(auditLog.recordId, target.id)));
    expect(beforeDelete).toHaveLength(0);

    const outcome = await withUserContext(owner.id, (tx) => deleteUserAccount(tx, owner.id, target.id));
    expect(outcome.ok).toBe(true);

    const afterDelete = await adminDb.select().from(auditLog).where(and(eq(auditLog.tableName, "users"), eq(auditLog.recordId, target.id)));
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].action).toBe("UPDATE");
    expect(afterDelete[0].changedBy).toBe(owner.id);
  });

  it("owner nesmie zmazať sám seba — DB ostáva nezmenená", async () => {
    const orgId = await newOrg();
    const owner = await newUser(orgId, { role: "owner" });
    const outcome = await withUserContext(owner.id, (tx) => deleteUserAccount(tx, owner.id, owner.id));
    expect(outcome.ok).toBe(false);

    const [after] = await adminDb.select().from(users).where(eq(users.id, owner.id));
    expect(after.isActive).toBe(true);
    expect(after.deletedAt).toBeNull();
  });

  it("posledný aktívny owner sa nedá zmazať — DB ostáva nezmenená, zrozumiteľná hláška", async () => {
    const orgId = await newOrg();
    const onlyOwner = await newUser(orgId, { role: "owner" });
    const manager = await newUser(orgId, { role: "manager" });

    // adminDb (bypassRLS), nie withUserContext(manager.id, ...) — testuje
    // guard PRIAMO vo `deleteUserAccount`, oddelene od RLS viditeľnosti (tú
    // pokrývajú testy v lib/db/rls-*.test.ts). V produkcii je actingUser vždy
    // owner (requireRole("owner") v server action), tento test len overuje,
    // že invariant "aspoň jeden aktívny owner" platí nezávisle na volajúcom.
    const outcome = await adminDb.transaction((tx) => deleteUserAccount(tx, manager.id, onlyOwner.id));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("posledný aktívny majiteľ");

    const [after] = await adminDb.select().from(users).where(eq(users.id, onlyOwner.id));
    expect(after.isActive).toBe(true);
    expect(after.deletedAt).toBeNull();
  });

  it("Supabase Auth účet už neexistuje (opakovaný pokus po čiastočnom zlyhaní) — soft-delete aj tak prejde", async () => {
    const orgId = await newOrg();
    const owner = await newUser(orgId, { role: "owner" });
    const target = await newUserWithRealAuth(orgId, "manager");
    const admin = createSupabaseAdminClient();
    await admin.auth.admin.deleteUser(target.authUserId!); // simuluje predošlé čiastočné zlyhanie
    const idx = createdAuthUserIds.indexOf(target.authUserId!);
    if (idx >= 0) createdAuthUserIds.splice(idx, 1);

    const outcome = await withUserContext(owner.id, (tx) => deleteUserAccount(tx, owner.id, target.id));
    expect(outcome.ok).toBe(true);

    const [after] = await adminDb.select().from(users).where(eq(users.id, target.id));
    expect(after.deletedAt).not.toBeNull();
  });
});

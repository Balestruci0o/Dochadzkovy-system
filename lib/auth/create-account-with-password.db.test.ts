import { createClient } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { employees, employeeWorkplaces, managerWorkplaces, users, workplaces } from "@/lib/db/schema";
import { testOrg } from "@/lib/db/test-fixture";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createEmployeeAccountWithPassword, createOwnerOrManagerAccountWithPassword } from "./create-account-with-password";

/**
 * "Nastaviť heslo teraz" — obchádza pozvánkový (email) tok, ktorý spôsobil
 * incident so sirotským Auth účtom (2026-08) (Supabase Admin API
 * generateLink/createUser zlyhávalo ~10-20%, nechávalo sirotský Auth účet).
 * Kľúčové správanie na overenie: (1) konto vzniká HNEĎ aktívne a prihlásenie
 * zadaným heslom naozaj funguje, (2) duplicitný email (DB aj Auth-side
 * "email_exists") dá čitateľnú hlášku BEZ vytvorenia sirotského stavu, (3) ak
 * DB zápis zlyhá PO úspešnom vytvorení Auth účtu, ten sa kompenzačne zmaže
 * naspäť — presne opačný prípad než pôvodný `.catch(() => {})` bug.
 */

const org = testOrg("create-account-with-password-test");
const createdAuthUserIds: string[] = [];
const VALID_PASSWORD = "correct-horse-battery-staple-42";

async function newEmployee(email: string | null) {
  const [employee] = await adminDb
    .insert(employees)
    .values({ orgId: org.id, firstName: "Test", lastName: "Zamestnanec", hiredOn: "2024-01-01", email })
    .returning();
  return employee;
}

afterEach(async () => {
  const admin = createSupabaseAdminClient();
  while (createdAuthUserIds.length > 0) {
    const id = createdAuthUserIds.pop()!;
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe("createEmployeeAccountWithPassword", () => {
  it("vytvorí konto HNEĎ aktívne, naviaže employees.user_id, a prihlásenie zadaným heslom naozaj funguje", async () => {
    const email = `pw-test-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);

    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountWithPassword(tx, {
        employeeId: employee.id,
        orgId: org.id,
        email,
        fullName: "Test Zamestnanec",
        password: VALID_PASSWORD,
      }),
    );
    expect(outcome.ok).toBe(true);

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).not.toBeNull();

    const [userRow] = await adminDb.select().from(users).where(eq(users.id, updatedEmployee.userId!));
    expect(userRow.role).toBe("employee");
    expect(userRow.email).toBe(email);
    expect(userRow.activatedAt).not.toBeNull(); // hneď aktívne — žiadne čakanie na "nastav si heslo"
    createdAuthUserIds.push(userRow.authUserId!);

    // Reálne prihlásenie presne tým heslom, čo sme zadali — nie mock.
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { data, error } = await anon.auth.signInWithPassword({ email, password: VALID_PASSWORD });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(userRow.authUserId);
  });

  it("email už patrí inému kontu v DB → čitateľná chyba, employees.user_id ostáva NULL, ŽIADEN Auth účet nevznikne", async () => {
    const email = `pw-taken-${crypto.randomUUID()}@test.local`;
    await adminDb.insert(users).values({ orgId: org.id, email, role: "employee", fullName: "Existujúce konto" });

    const employee = await newEmployee(email);
    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountWithPassword(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec", password: VALID_PASSWORD }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("už patrí");

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).toBeNull();

    // Predbežná DB kontrola beží PRED Supabase volaním — nemal vzniknúť žiadny Auth účet.
    const admin = createSupabaseAdminClient();
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(data.user).not.toBeNull(); // email bol v Auth ešte voľný
    createdAuthUserIds.push(data.user!.id);
  });

  it("príliš krátke heslo → čitateľná chyba (lib/auth/password.ts), ŽIADEN Auth účet nevznikne", async () => {
    const email = `pw-weak-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);

    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountWithPassword(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec", password: "kratke" }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("aspoň 12 znakov");

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).toBeNull();

    const admin = createSupabaseAdminClient();
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(data.user).not.toBeNull(); // email bol v Auth ešte voľný
    createdAuthUserIds.push(data.user!.id);
  });

  it("email už existuje v Supabase Auth, ale nemá zodpovedajúce users konto (sirota po staršom zmazaní) → zrozumiteľná hláška, nie surová 'already registered'", async () => {
    const email = `pw-orphan-${crypto.randomUUID()}@test.local`;
    const admin = createSupabaseAdminClient();
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    createdAuthUserIds.push(data.user!.id);

    const employee = await newEmployee(email);
    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountWithPassword(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec", password: VALID_PASSWORD }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.message).not.toContain("already been registered");
      expect(outcome.message).toContain("pozostatok po staršom zmazaní");
    }

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).toBeNull();
    const [userRow] = await adminDb.select().from(users).where(and(eq(users.orgId, org.id), eq(users.email, email)));
    expect(userRow).toBeUndefined();
  });

  it("Auth účet vznikne, ale DB zápis zlyhá (neplatný orgId) → kompenzačne sa Auth účet ZMAŽE naspäť, žiadny sirotský stav", async () => {
    const email = `pw-compensate-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);
    const bogusOrgId = crypto.randomUUID(); // neexistujúca organizácia → FK violation na users.insert

    await expect(
      adminDb.transaction((tx) =>
        createEmployeeAccountWithPassword(tx, { employeeId: employee.id, orgId: bogusOrgId, email, fullName: "Test Zamestnanec", password: VALID_PASSWORD }),
      ),
    ).rejects.toThrow();

    // Kompenzácia prebehla → email je znova voľný v Supabase Auth (presný opak incidentu).
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(error).toBeNull();
    expect(data.user).not.toBeNull();
    createdAuthUserIds.push(data.user!.id);
  });

  /**
   * Regresný test na predchádzajúci bug objavený naživo pri Fáze 3
   * (granulárne pravomoci manažérov) — nesúvisí s pravomocami. Rovnaký
   * dôvod ako `invite-employee.test.ts`'s regresný test: manažér pod
   * skutočnou RLS nevidí NOVÝ users riadok skôr, než vznikne väzba
   * `employees.user_id`, takže `.returning({id})` po INSERTe predtým vždy
   * zlyhalo pre KAŽDÉHO manažéra (nikdy pre ownera — preto sa to
   * nechytilo). Opravené (ID na klientovi, žiadne `.returning()`).
   */
  it("REGRESIA — funguje aj keď ju spustí MANAŽÉR pod skutočnou RLS (nie adminDb), nie len owner", async () => {
    const managerAuthId = crypto.randomUUID();
    const [manager] = await adminDb
      .insert(users)
      .values({ orgId: org.id, authUserId: managerAuthId, email: `mgr-${crypto.randomUUID()}@pw-rls-test.local`, role: "manager", fullName: "Test Manažér" })
      .returning();
    // emp_write (employees UPDATE) vyžaduje, aby bol zamestnanec vo VLASTNEJ
    // prevádzke manažéra — bez toho by zlyhal NÁSLEDNÝ krok (naviazanie
    // employees.user_id), nezávisle od tohto testu overovanej opravy.
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    await adminDb.insert(managerWorkplaces).values({ userId: manager.id, workplaceId: wp.id });

    const email = `pw-manager-rls-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId: wp.id });

    const outcome = await withUserContext(manager.id, (tx) =>
      createEmployeeAccountWithPassword(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec", password: VALID_PASSWORD }),
    );

    expect(outcome.ok).toBe(true);
    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).not.toBeNull();
    const [userRow] = await adminDb.select().from(users).where(eq(users.id, updatedEmployee.userId!));
    expect(userRow.role).toBe("employee");
    createdAuthUserIds.push(userRow.authUserId!);
  });
});

describe("createOwnerOrManagerAccountWithPassword", () => {
  it("role='owner' → konto HNEĎ aktívne, prihlásenie zadaným heslom funguje, ŽIADNE manager_workplaces ani keď workplaceIds prídu", async () => {
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const email = `pw-owner-${crypto.randomUUID()}@test.local`;

    const outcome = await adminDb.transaction((tx) =>
      createOwnerOrManagerAccountWithPassword(tx, { orgId: org.id, email, fullName: "Druhý Majiteľ", phone: null, role: "owner", workplaceIds: [wp.id], password: VALID_PASSWORD }),
    );
    expect(outcome.ok).toBe(true);

    const [userRow] = await adminDb.select().from(users).where(eq(users.email, email));
    expect(userRow.role).toBe("owner");
    expect(userRow.activatedAt).not.toBeNull();
    createdAuthUserIds.push(userRow.authUserId!);

    const wpRows = await adminDb.select().from(managerWorkplaces).where(eq(managerWorkplaces.userId, userRow.id));
    expect(wpRows).toHaveLength(0);

    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { data, error } = await anon.auth.signInWithPassword({ email, password: VALID_PASSWORD });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(userRow.authUserId);
  });

  it("role='manager' → konto s naviazanými prevádzkami (manager_workplaces)", async () => {
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Office", code: `OFFICE-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const email = `pw-manager-${crypto.randomUUID()}@test.local`;

    const outcome = await adminDb.transaction((tx) =>
      createOwnerOrManagerAccountWithPassword(tx, { orgId: org.id, email, fullName: "Test Manažér", phone: null, role: "manager", workplaceIds: [wp.id], password: VALID_PASSWORD }),
    );
    expect(outcome.ok).toBe(true);

    const [userRow] = await adminDb.select().from(users).where(eq(users.email, email));
    expect(userRow.role).toBe("manager");
    createdAuthUserIds.push(userRow.authUserId!);

    const wpRows = await adminDb.select().from(managerWorkplaces).where(eq(managerWorkplaces.userId, userRow.id));
    expect(wpRows).toHaveLength(1);
  });

  it("Auth účet vznikne, ale DB zápis zlyhá (neplatný orgId) → kompenzačne sa Auth účet ZMAŽE naspäť", async () => {
    const email = `pw-owner-compensate-${crypto.randomUUID()}@test.local`;
    const bogusOrgId = crypto.randomUUID();

    await expect(
      adminDb.transaction((tx) =>
        createOwnerOrManagerAccountWithPassword(tx, { orgId: bogusOrgId, email, fullName: "Druhý Majiteľ", phone: null, role: "owner", workplaceIds: [], password: VALID_PASSWORD }),
      ),
    ).rejects.toThrow();

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    expect(error).toBeNull();
    expect(data.user).not.toBeNull();
    createdAuthUserIds.push(data.user!.id);
  });
});

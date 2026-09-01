import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { employees, employeeWorkplaces, managerWorkplaces, users, workplaces } from "@/lib/db/schema";
import { testOrg } from "@/lib/db/test-fixture";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createEmployeeAccountAndInvite, createOwnerOrManagerAccountAndInvite, resendAccountInvite } from "./invite-employee";

/**
 * Spája dovtedy oddelené "založ zamestnanca" a "pozvi do systému" — kľúčové
 * správanie na overenie: (1) `employees.user_id` sa NAVIAŽE, (2) zlyhanie
 * pozvánky/emailu NEHÁDŽE (volajúca server action musí zamestnanca vytvoriť
 * aj tak), (3) duplicitný email je čitateľná chyba, nie pád.
 *
 * `sendEmail` je mockovaný (nepošle reálny mail cez Resend). Skutočné
 * Supabase Auth kontá VZNIKAJÚ reálne (`generateLink` ich musí vytvoriť) —
 * čistené v `afterEach` cez `admin.auth.admin.deleteUser`, rovnaký vzor ako
 * `lib/auth/session.test.ts`.
 */

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...args) }));

const org = testOrg("invite-employee-test");
const createdAuthUserIds: string[] = [];

async function newEmployee(email: string | null) {
  const [employee] = await adminDb
    .insert(employees)
    .values({ orgId: org.id, firstName: "Test", lastName: "Zamestnanec", hiredOn: "2024-01-01", email })
    .returning();
  return employee;
}

beforeAll(() => {
  createdAuthUserIds.length = 0;
});

afterEach(async () => {
  sendEmailMock.mockClear();
  const admin = createSupabaseAdminClient();
  while (createdAuthUserIds.length > 0) {
    const id = createdAuthUserIds.pop()!;
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
});

describe("createEmployeeAccountAndInvite", () => {
  it("vytvorí konto, prepojí employees.user_id, a pošle pozvánku", async () => {
    const email = `invite-test-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);

    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountAndInvite(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec" }),
    );

    expect(outcome.ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).not.toBeNull();

    const [userRow] = await adminDb.select().from(users).where(eq(users.email, email));
    expect(userRow).toBeDefined();
    expect(userRow.role).toBe("employee");
    expect(userRow.id).toBe(updatedEmployee.userId);
    createdAuthUserIds.push(userRow.authUserId!);
  });

  it("email už patrí inému kontu → čitateľná chyba, employees.user_id ostáva NULL, žiadny pád", async () => {
    const email = `invite-taken-${crypto.randomUUID()}@test.local`;
    const admin = createSupabaseAdminClient();
    const { data } = await admin.auth.admin.createUser({ email, email_confirm: true });
    createdAuthUserIds.push(data.user!.id);
    await adminDb.insert(users).values({ orgId: org.id, authUserId: data.user!.id, email, role: "employee", fullName: "Už existuje" });

    const employee = await newEmployee(email);
    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountAndInvite(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec" }),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("už patrí");
    expect(sendEmailMock).not.toHaveBeenCalled();

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).toBeNull();
  });

  it("zlyhanie odoslania pozvánky (Resend) NEHÁDŽE — konto aj employees.user_id sa aj tak vytvoria", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("Resend API zlyhalo"));
    const email = `invite-sendfail-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);

    const outcome = await adminDb.transaction((tx) =>
      createEmployeeAccountAndInvite(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec" }),
    );

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("Konto bolo vytvorené");

    // Kľúčové: konto a väzba EXISTUJÚ napriek zlyhaniu emailu — owner ich uvidí
    // ako "Pozvaný, čaká na aktiváciu" a môže poslať pozvánku znova.
    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).not.toBeNull();
    const [userRow] = await adminDb.select().from(users).where(eq(users.id, updatedEmployee.userId!));
    expect(userRow).toBeDefined();
    createdAuthUserIds.push(userRow.authUserId!);
  });

  /**
   * Regresný test na predchádzajúci bug objavený naživo pri Fáze 3
   * (granulárne pravomoci manažérov) — nesúvisí s pravomocami, existoval
   * predtým, len ho doteraz NIČ v tomto súbore nechytilo, lebo všetky ostatné
   * testy bežia cez `adminDb.transaction()` (RLS úplne obchádza, superuser).
   * Skutočný `/pozvat` beží ako MANAŽÉR pod RLS (`withUserContext`) — funkcia
   * predtým robila `.insert(users)...returning({id})`, ale manažér (na
   * rozdiel od ownera) nevidí NOVÝ users riadok cez RLS SELECT skôr, než
   * vznikne väzba `employees.user_id` (users_select_manager to vyžaduje) —
   * `.returning()` preto pod RLS zlyhalo s "violates row-level security
   * policy" pre KAŽDÉHO manažéra, VŽDY. Opravené (ID generované na klientovi,
   * žiadne `.returning()`) — tento test to zamyká, nech sa to nestratí.
   */
  it("REGRESIA — funguje aj keď ju spustí MANAŽÉR pod skutočnou RLS (nie adminDb), nie len owner", async () => {
    const managerAuthId = crypto.randomUUID();
    const [manager] = await adminDb
      .insert(users)
      .values({ orgId: org.id, authUserId: managerAuthId, email: `mgr-${crypto.randomUUID()}@invite-rls-test.local`, role: "manager", fullName: "Test Manažér" })
      .returning();
    // emp_write (employees UPDATE) vyžaduje, aby bol zamestnanec vo VLASTNEJ
    // prevádzke manažéra (employee_workplaces ∩ manager_workplaces) — bez
    // toho by zlyhal NÁSLEDNÝ krok (naviazanie employees.user_id), nezávisle
    // od tohto testu overovanej users-INSERT/RETURNING opravy.
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    await adminDb.insert(managerWorkplaces).values({ userId: manager.id, workplaceId: wp.id });

    const email = `invite-manager-rls-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);
    await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId: wp.id });

    const outcome = await withUserContext(manager.id, (tx) =>
      createEmployeeAccountAndInvite(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec" }),
    );

    expect(outcome.ok).toBe(true);
    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    expect(updatedEmployee.userId).not.toBeNull();
    const [userRow] = await adminDb.select().from(users).where(eq(users.email, email));
    expect(userRow.role).toBe("employee");
    createdAuthUserIds.push(userRow.authUserId!);
  });
});

describe("resendAccountInvite", () => {
  it("pošle novú pozvánku existujúcemu, ešte neaktivovanému kontu (bumpne invitedAt)", async () => {
    const email = `invite-resend-${crypto.randomUUID()}@test.local`;
    const employee = await newEmployee(email);
    const created = await adminDb.transaction((tx) =>
      createEmployeeAccountAndInvite(tx, { employeeId: employee.id, orgId: org.id, email, fullName: "Test Zamestnanec" }),
    );
    expect(created.ok).toBe(true);
    sendEmailMock.mockClear();

    const [updatedEmployee] = await adminDb.select().from(employees).where(eq(employees.id, employee.id));
    const [userBefore] = await adminDb.select().from(users).where(eq(users.id, updatedEmployee.userId!));
    createdAuthUserIds.push(userBefore.authUserId!);

    await new Promise((r) => setTimeout(r, 5));
    const outcome = await adminDb.transaction((tx) =>
      resendAccountInvite(tx, { userId: userBefore.id, email, fullName: "Test Zamestnanec" }),
    );

    expect(outcome.ok).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    const [userAfter] = await adminDb.select().from(users).where(eq(users.id, userBefore.id));
    expect(userAfter.invitedAt!.getTime()).toBeGreaterThan(userBefore.invitedAt!.getTime());
  });
});

describe("createOwnerOrManagerAccountAndInvite", () => {
  it("role='manager' → konto s rolou manager, naviazané prevádzky (manager_workplaces)", async () => {
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Hotel", code: `HOTEL-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const email = `owner-or-mgr-manager-${crypto.randomUUID()}@test.local`;

    const outcome = await adminDb.transaction((tx) =>
      createOwnerOrManagerAccountAndInvite(tx, { orgId: org.id, email, fullName: "Test Manažér", phone: null, role: "manager", workplaceIds: [wp.id] }),
    );
    expect(outcome.ok).toBe(true);

    const [userRow] = await adminDb.select().from(users).where(eq(users.email, email));
    expect(userRow.role).toBe("manager");
    createdAuthUserIds.push(userRow.authUserId!);

    const wpRows = await adminDb.select().from(managerWorkplaces).where(eq(managerWorkplaces.userId, userRow.id));
    expect(wpRows).toHaveLength(1);
  });

  it("role='owner' → konto s rolou owner, manager_workplaces sa NEVYTVORÍ ani keď workplaceIds prídu (owner prevádzky nepotrebuje)", async () => {
    const [wp] = await adminDb.insert(workplaces).values({ orgId: org.id, name: "Office", code: `OFFICE-${crypto.randomUUID().slice(0, 8)}` }).returning();
    const email = `owner-or-mgr-owner-${crypto.randomUUID()}@test.local`;

    const outcome = await adminDb.transaction((tx) =>
      createOwnerOrManagerAccountAndInvite(tx, { orgId: org.id, email, fullName: "Druhý Majiteľ", phone: null, role: "owner", workplaceIds: [wp.id] }),
    );
    expect(outcome.ok).toBe(true);

    const [userRow] = await adminDb.select().from(users).where(eq(users.email, email));
    expect(userRow.role).toBe("owner");
    createdAuthUserIds.push(userRow.authUserId!);

    const wpRows = await adminDb.select().from(managerWorkplaces).where(eq(managerWorkplaces.userId, userRow.id));
    expect(wpRows).toHaveLength(0);
  });

  it("duplicitný email → čitateľná chyba, žiadne nové konto", async () => {
    const email = `owner-or-mgr-dup-${crypto.randomUUID()}@test.local`;
    await adminDb.insert(users).values({ orgId: org.id, email, role: "manager", fullName: "Existujúce konto" });

    const outcome = await adminDb.transaction((tx) =>
      createOwnerOrManagerAccountAndInvite(tx, { orgId: org.id, email, fullName: "Druhý Majiteľ", phone: null, role: "owner", workplaceIds: [] }),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message).toContain("už patrí");
  });
});

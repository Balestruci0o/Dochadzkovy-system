import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { employees, managerWorkplaces, users } from "@/lib/db/schema";
import { validatePassword } from "@/lib/auth/password";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isUniqueViolation } from "./invite-employee";

type Tx = PostgresJsDatabase<typeof schema>;

export type CreateAccountOutcome = { ok: true } | { ok: false; message: string };

/**
 * Obchádza pozvánkový (email) tok úplne — owner/manažér zadá heslo priamo,
 * konto vznikne HNEĎ aktívne (`activatedAt` sa nastaví ihneď, žiadny
 * `generateLink`, žiadny email). Vzniklo po incidente so sirotským Auth
 * účtom (2026-08), kde Supabase Admin API (generateLink/createUser) občas
 * zlyhávalo a nechávalo sirotský Auth účet.
 *
 * KOMPENZÁCIA namiesto tichého sirotstva (rovnaká lekcia ako
 * `confirmDeleteEmployeeAction`'s `authCleanupFailed`, viď
 * `app/(app)/zamestnanci/[id]/actions.ts`): ak Auth účet vznikne, ale
 * následný DB zápis (`users` insert / `employees.user_id` naviazanie)
 * zlyhá, Auth účet sa OKAMŽITE zmaže naspäť — inak by presne to isté
 * "sirotský Auth účet blokuje budúcu pozvánku" nastalo znova.
 */
export async function createEmployeeAccountWithPassword(
  tx: Tx,
  params: { employeeId: string; orgId: string; email: string; fullName: string; password: string },
): Promise<CreateAccountOutcome> {
  // Best-effort predbežná kontrola (rovnaký vzor ako createEmployeeAccountAndInvite)
  // — skutočnú ochranu pre TENTO org dáva UNIQUE(org_id, email) v DB, zachytené nižšie.
  const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, params.email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
  }

  const check = await validatePassword(params.password);
  if (!check.valid) {
    return { ok: false, message: check.error };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
  });

  if (error || !data.user) {
    if (error?.code === "email_exists") {
      // Presne ten istý incident so sirotským Auth účtom (2026-08) — sirotský
      // Auth účet po staršom (dnes už opravenom) zlyhaní zmazania blokuje
      // nové konto. Surová "already been registered" hláška by ownera len
      // zmiatla.
      return {
        ok: false,
        message:
          "Tento email je už zaregistrovaný v prihlasovacom systéme (Supabase Auth), ale nepatrí žiadnemu kontu tu — pravdepodobne pozostatok po staršom zmazaní. Kontaktuj podporu, nech ho ručne uvoľní, alebo použi iný email.",
      };
    }
    return { ok: false, message: `Nepodarilo sa vytvoriť konto: ${error?.message ?? "neznáma chyba"}` };
  }

  const authUserId = data.user.id;

  // ID generované NA KLIENTOVI, nie .returning() — rovnaký dôvod ako
  // createEmployeeAccountAndInvite (invite-employee.ts): manažér nevidí NOVÝ
  // users riadok cez RLS SELECT skôr, než vznikne väzba employees.user_id
  // nižšie, takže .returning({id}) by pod RLS zlyhalo. Objavené naživo pri
  // Fáze 3, nesúvisí s touto funkciou — predchádzajúci bug, opravený tu.
  const newUserId = crypto.randomUUID();
  try {
    await tx.insert(users).values({
      id: newUserId,
      orgId: params.orgId,
      authUserId,
      email: params.email,
      role: "employee",
      fullName: params.fullName,
      activatedAt: new Date(),
    });

    await tx.update(employees).set({ userId: newUserId }).where(eq(employees.id, params.employeeId));
  } catch (err) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(authUserId);
    if (cleanupError) {
      console.error(
        `createEmployeeAccountWithPassword: DB zápis zlyhal AJ kompenzačné zmazanie Auth účtu ${authUserId} zlyhalo:`,
        cleanupError.message,
      );
    }
    if (isUniqueViolation(err)) {
      return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
    }
    throw err;
  }

  return { ok: true };
}

/**
 * Manažérsky/vlastnícky/účtovnícky náprotivok `createEmployeeAccountWithPassword`
 * — rovnaká motivácia (obchádza nespoľahlivý pozvánkový tok), rovnaká
 * kompenzácia pri zlyhaní DB zápisu. Bez `employees` riadku (žiadne
 * naviazanie), namiesto toho voliteľné `manager_workplaces` — ale LEN pre
 * `role: "manager"` (owner aj accountant vidia celú organizáciu,
 * viď accessible_workplaces()), takže `workplaceIds` sa
 * pre nich ignoruje, aj keby prišli.
 *
 * "Kto smie vytvoriť ownera" a "kto smie vytvoriť manager/accountant"
 * vynucuje volajúca server action (`requirePermission("manageAccounts")` v
 * `konta/actions.ts`, pre `role: "owner"` navyše `requireRole("owner")`),
 * nie táto funkcia — a nezávisle aj RLS (`users_insert_manager`, migrácia
 * 0049): `role: "owner"` cez túto cestu nikdy neprejde pre manažéra, bez
 * ohľadu na to, čo by táto funkcia dostala zavolať.
 */
export async function createOwnerOrManagerAccountWithPassword(
  tx: Tx,
  params: { orgId: string; email: string; fullName: string; phone: string | null; role: "owner" | "manager" | "accountant"; workplaceIds: string[]; password: string },
): Promise<CreateAccountOutcome> {
  const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, params.email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
  }

  const check = await validatePassword(params.password);
  if (!check.valid) {
    return { ok: false, message: check.error };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: params.email,
    password: params.password,
    email_confirm: true,
  });

  if (error || !data.user) {
    if (error?.code === "email_exists") {
      return {
        ok: false,
        message:
          "Tento email je už zaregistrovaný v prihlasovacom systéme (Supabase Auth), ale nepatrí žiadnemu kontu tu — pravdepodobne pozostatok po staršom zmazaní. Kontaktuj podporu, nech ho ručne uvoľní, alebo použi iný email.",
      };
    }
    return { ok: false, message: `Nepodarilo sa vytvoriť konto: ${error?.message ?? "neznáma chyba"}` };
  }

  const authUserId = data.user.id;

  try {
    const [inserted] = await tx
      .insert(users)
      .values({
        orgId: params.orgId,
        authUserId,
        email: params.email,
        role: params.role,
        fullName: params.fullName,
        phone: params.phone,
        activatedAt: new Date(),
      })
      .returning({ id: users.id });

    if (params.role === "manager" && params.workplaceIds.length > 0) {
      await tx.insert(managerWorkplaces).values(params.workplaceIds.map((workplaceId) => ({ userId: inserted.id, workplaceId })));
    }
  } catch (err) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(authUserId);
    if (cleanupError) {
      console.error(
        `createOwnerOrManagerAccountWithPassword: DB zápis zlyhal AJ kompenzačné zmazanie Auth účtu ${authUserId} zlyhalo:`,
        cleanupError.message,
      );
    }
    if (isUniqueViolation(err)) {
      return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
    }
    throw err;
  }

  return { ok: true };
}

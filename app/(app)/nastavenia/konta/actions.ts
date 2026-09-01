"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createOwnerOrManagerAccountWithPassword } from "@/lib/auth/create-account-with-password";
import { checkAccountDeletable, deleteUserAccount, hasOtherActiveOwner } from "@/lib/auth/delete-account";
import { createOwnerOrManagerAccountAndInvite, resendAccountInvite } from "@/lib/auth/invite-employee";
import { requirePermission, requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { managerPermissions, managerWorkplaces, organizations, users } from "@/lib/db/schema";
import { requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";

export type ActionState = { error?: string; success?: boolean };

function parseOptionalText(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

/**
 * Blok 13, bod 2 (rozšírené Fázou 3) — miesto, kde vzniká manažérske,
 * účtovnícke ALEBO ĎALŠIE vlastnícke konto. Owner ALEBO manažér s
 * `manage_accounts` (`requirePermission("manageAccounts")` nižšie) — ale
 * `role: "owner"` smie vytvoriť VÝHRADNE owner, vynútené TU explicitne
 * (zrozumiteľná hláška namiesto surovej DB chyby) AJ nezávisle v RLS
 * (`users_insert_manager`, migrácia 0049 — pre manažéra 'owner' nie je v
 * ŽIADNEJ vetve tej politiky, takže by aj bez tejto kontroly zlyhal zápis,
 * len s horšou hláškou). Rovnaký vzor ako `createEmployeeAction`
 * (`app/(app)/zamestnanci/actions.ts`) — `accountMode` "invite" | "password",
 * žiadny email pri "password". Owner/accountant nedostávajú
 * `manager_workplaces` (vidia všetky prevádzky) — `workplaceIds` sa pre nich
 * ignoruje aj keby ich formulár poslal (viď `createOwnerOrManagerAccount*`).
 */
export async function createOwnerOrManagerAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageAccounts");

  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = parseOptionalText(formData.get("phone"));
  const roleRaw = String(formData.get("role") ?? "manager");
  const role = roleRaw === "owner" ? ("owner" as const) : roleRaw === "accountant" ? ("accountant" as const) : ("manager" as const);
  const workplaceIds = formData.getAll("workplaceIds").map(String).filter(Boolean);
  const accountModeRaw = String(formData.get("accountMode") ?? "invite");
  const accountMode = accountModeRaw === "password" ? "password" as const : "invite" as const;
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (role === "owner" && user.role !== "owner") {
    return { error: "Len majiteľ môže vytvoriť ďalšie majiteľské konto." };
  }
  if (!fullName) return { error: "Vyplň meno." };
  if (!email) return { error: "Vyplň email." };
  if (accountMode === "password" && password !== passwordConfirm) {
    return { error: "Heslá sa nezhodujú." };
  }

  const outcome = await withUserContext(user.id, (tx) =>
    accountMode === "password"
      ? createOwnerOrManagerAccountWithPassword(tx, { orgId: user.orgId, email, fullName, phone, role, workplaceIds, password })
      : createOwnerOrManagerAccountAndInvite(tx, { orgId: user.orgId, email, fullName, phone, role, workplaceIds }),
  );

  revalidatePath("/nastavenia/konta");
  if (!outcome.ok) return { error: outcome.message };
  return { success: true };
}

export async function resendAccountInviteAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("userId") ?? "");
  if (!targetUserId) return;

  await withUserContext(user.id, async (tx) => {
    const [account] = await tx.select().from(users).where(eq(users.id, targetUserId));
    if (!account || account.activatedAt || account.email === null) return;
    await resendAccountInvite(tx, { userId: account.id, email: account.email, fullName: account.fullName });
  });

  revalidatePath("/nastavenia/konta");
}

/**
 * Owner nesmie deaktivovať SEBA (`targetUserId === user.id`) — inak by sa
 * ľahko zamkol mimo appky. Viacero ownerov je teraz bežné (pozri
 * `createOwnerOrManagerAccountAction`), takže deaktivovať INÉHO ownera je
 * v poriadku — okrem POSLEDNÉHO aktívneho (`hasOtherActiveOwner`, rovnaký
 * invariant ako pri mazaní, `lib/auth/delete-account.ts`). Aktivácia
 * (`nextActive=true`) nikdy nie je nebezpečná, tú kontrola nerieši.
 *
 * Fáza 3 — manažér s `manage_accounts` smie touto akciou prepnúť VÝHRADNE
 * konto s rolou 'employee' (kontrola `target.role !== "employee"` nižšie je
 * zrozumiteľnejšia hláška/no-op namiesto surovej DB chyby — RLS
 * `users_update_manage_accounts`, migrácia 0049, by aj bez tejto vetvy
 * zamietla UPDATE na manager/owner/accountant cieľ, keďže tá politika sama
 * vyžaduje `role = 'employee'`).
 */
export async function toggleAccountActiveAction(formData: FormData): Promise<void> {
  const user = await requirePermission("manageAccounts");
  const targetUserId = String(formData.get("userId") ?? "");
  const nextActive = formData.get("nextActive") === "true";
  if (!targetUserId || targetUserId === user.id) return;

  await withUserContext(user.id, async (tx) => {
    const [target] = await tx.select({ role: users.role, orgId: users.orgId }).from(users).where(eq(users.id, targetUserId));
    if (!target) return;
    if (user.role !== "owner" && target.role !== "employee") return;
    if (!nextActive) {
      if (target.role === "owner" && !(await hasOtherActiveOwner(tx, target.orgId, targetUserId))) {
        return;
      }
    }
    await tx.update(users).set({ isActive: nextActive }).where(eq(users.id, targetUserId));
  });

  revalidatePath("/nastavenia/konta");
}

export async function updateAccountPhoneAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("userId") ?? "");
  const phone = parseOptionalText(formData.get("phone"));
  if (!targetUserId) return;

  await withUserContext(user.id, (tx) => tx.update(users).set({ phone }).where(eq(users.id, targetUserId)));

  revalidatePath("/nastavenia/konta");
  revalidatePath("/kontakt");
}

export async function assignManagerWorkplaceAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("userId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  if (!targetUserId || !workplaceId) return;

  await withUserContext(user.id, (tx) =>
    tx.insert(managerWorkplaces).values({ userId: targetUserId, workplaceId }).onConflictDoNothing(),
  );

  revalidatePath("/nastavenia/konta");
}

export async function unassignManagerWorkplaceAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("userId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  if (!targetUserId || !workplaceId) return;

  await withUserContext(user.id, (tx) =>
    tx.delete(managerWorkplaces).where(and(eq(managerWorkplaces.userId, targetUserId), eq(managerWorkplaces.workplaceId, workplaceId))),
  );

  revalidatePath("/nastavenia/konta");
}

/**
 * Granulárne pravomoci manažérov, Fázy 2-3 — VÝHRADNE owner, BEZ VÝNIMKY
 * (anti-eskalácia, migrácia 0047: manager_permissions_write je RLS-vynútené
 * is_owner()-only, žiadna balíčková vetva — tento `requireRole("owner")` je
 * len prvá, aplikačná vrstva tej istej záruky). Posiela 4 zo 6 stĺpcov
 * (viewWages/editWages pridá Fáza 4) — `onConflictDoUpdate`.`set` obsahuje
 * LEN tieto štyri, aby sa pri update neprepísali stĺpce, ktoré ešte tento
 * formulár nezobrazuje.
 */
export async function updateManagerPermissionsAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("userId") ?? "");
  if (!targetUserId) return;

  const managePositionsShifts = formData.get("managePositionsShifts") === "on";
  const manageRules = formData.get("manageRules") === "on";
  const manageTerminals = formData.get("manageTerminals") === "on";
  const manageAccounts = formData.get("manageAccounts") === "on";

  await withUserContext(user.id, (tx) =>
    tx
      .insert(managerPermissions)
      .values({ userId: targetUserId, managePositionsShifts, manageRules, manageTerminals, manageAccounts, updatedBy: user.id })
      .onConflictDoUpdate({
        target: managerPermissions.userId,
        set: { managePositionsShifts, manageRules, manageTerminals, manageAccounts, updatedAt: new Date(), updatedBy: user.id },
      }),
  );

  revalidatePath("/nastavenia/konta");
}

/**
 * Zmazanie PRIHLASOVACIEHO konta (soft-delete, `lib/auth/delete-account.ts`)
 * — Blok 14 vzor (kód mailom), rovnaké dva kroky ako pri pozíciách. Rýchly
 * `checkAccountDeletable` pred poslaním kódu ušetrí mail, keď je jasné, že
 * mazanie aj tak neprejde (napr. posledný aktívny owner).
 */
export async function requestDeleteUserAccountCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("id") ?? "");
  if (!targetUserId) return { error: "Chýba ID konta." };

  const guard = await withUserContext(user.id, (tx) => checkAccountDeletable(tx, user.id, targetUserId));
  if (!guard.ok) return { error: guard.message };

  await requestDeleteCode(user, "user_account", targetUserId, `Prihlasovacie konto „${guard.target.fullName}“`);
  return {};
}

export async function confirmDeleteUserAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");
  const targetUserId = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!targetUserId) return { error: "Chýba ID konta." };

  const verify = await verifyDeleteCode(user, "user_account", targetUserId, code);
  if (!verify.ok) return { error: verify.error };

  const outcome = await withUserContext(user.id, (tx) => deleteUserAccount(tx, user.id, targetUserId));
  if (!outcome.ok) return { error: outcome.message };

  revalidatePath("/nastavenia/konta");
  return { success: true };
}

export async function updateSupportContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");
  const supportName = parseOptionalText(formData.get("supportName"));
  const supportEmail = parseOptionalText(formData.get("supportEmail"));
  const supportPhone = parseOptionalText(formData.get("supportPhone"));

  await withUserContext(user.id, (tx) =>
    tx.update(organizations).set({ supportName, supportEmail, supportPhone }).where(eq(organizations.id, user.orgId)),
  );

  revalidatePath("/nastavenia/konta");
  revalidatePath("/kontakt");
  return { success: true };
}

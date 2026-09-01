import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { employees, managerWorkplaces, users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/resend";
import { inviteEmailHtml } from "@/lib/email/templates";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Tx = PostgresJsDatabase<typeof schema>;

export type InviteOutcome = { ok: true } | { ok: false; message: string };

export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /duplicate key value violates unique constraint/.test(String((err as { cause?: unknown }).cause ?? err.message))
  );
}

/**
 * Spája dovtedy oddelené kroky — "založ zamestnanca" a "pozvi ho do systému"
 * — do jedného: vytvorí NOVÉ prihlasovacie konto (Supabase Auth + `users`
 * riadok, rola VŽDY "employee") a prepojí `employees.user_id`. Toto je
 * presne tá väzba, ktorú `createEmployeeAction` (založenie) a
 * `inviteUserAction` (`/pozvat`) doteraz nikdy nevypĺňali — dva úplne
 * nezávislé toky, žiadny z nich o tom druhom nevedel.
 *
 * Zámerne NEHÁDŽE pri zlyhaní pozvánky/emailu — volajúca server action musí
 * zamestnanca vytvoriť (alebo ponechať) aj tak, len ukázať ownerovi
 * zrozumiteľnú chybu namiesto pádu celej akcie.
 */
export async function createEmployeeAccountAndInvite(
  tx: Tx,
  params: { employeeId: string; orgId: string; email: string; fullName: string },
): Promise<InviteOutcome> {
  // Best-effort predbežná kontrola (RLS môže obmedziť viditeľnosť naprieč
  // organizáciami) — skutočnú ochranu pre TENTO org dáva UNIQUE(org_id, email)
  // v DB, zachytené nižšie v catch. Rovnaký vzor ako app/pozvat/actions.ts.
  const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, params.email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
  }

  const admin = createSupabaseAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/nastavit-heslo`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: { redirectTo },
  });

  if (error || !data.user) {
    return { ok: false, message: `Nepodarilo sa vytvoriť pozvánku: ${error?.message ?? "neznáma chyba"}` };
  }

  // ID generované NA KLIENTOVI (nie .returning() po INSERT) — manažér (na
  // rozdiel od ownera) nevidí NOVÝ users riadok cez RLS SELECT skôr, než
  // vznikne väzba employees.user_id nižšie (users_select_manager to
  // vyžaduje), takže .returning({id}) by pod RLS zlyhalo s "violates
  // row-level security policy" pre KAŽDÉHO manažéra (owner to nikdy
  // neodhalil — users_select mu dáva viditeľnosť na celú org bez ohľadu na
  // väzbu). Objavené naživo pri Fáze 3 (granulárne pravomoci), nesúvisí s
  // touto funkciou — predchádzajúci bug, opravený tu.
  const newUserId = crypto.randomUUID();
  try {
    await tx.insert(users).values({
      id: newUserId,
      orgId: params.orgId,
      authUserId: data.user.id,
      email: params.email,
      role: "employee",
      fullName: params.fullName,
      invitedAt: new Date(),
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
    }
    throw err;
  }

  // Väzba, ktorú doteraz nikto nevypĺňal — bez nej by konto zostalo znova
  // "osirotené", presne ako Filip Arus.
  await tx.update(employees).set({ userId: newUserId }).where(eq(employees.id, params.employeeId));

  try {
    await sendEmail({
      to: params.email,
      subject: "Pozvánka do dochádzkového systému",
      html: inviteEmailHtml({ fullName: params.fullName, link: data.properties.action_link }),
    });
  } catch {
    // Konto UŽ existuje a JE prepojené — len samotné odoslanie zlyhalo.
    // Owner to uvidí ako "Pozvaný, čaká na aktiváciu" a môže poslať znova.
    return { ok: false, message: "Konto bolo vytvorené, ale odoslanie pozvánky zlyhalo. Skús to znova tlačidlom nižšie." };
  }

  return { ok: true };
}

/**
 * Blok 13, bod 2 (rozšírené Fázou 3 — granulárne pravomoci manažérov) —
 * owner ALEBO manažér s `manage_accounts` vytvorí manažérske/účtovnícke
 * konto, LEN owner smie vytvoriť ĎALŠIE vlastnícke ("kto smie vytvoriť
 * ownera" vynucuje `konta/actions.ts` + nezávisle RLS
 * `users_insert_manager`, migrácia 0049 — nie táto funkcia) a rovno mu
 * pridelí prevádzky (`manager_workplaces`, viacero naraz, LEN pre
 * `role: "manager"`). Owner aj accountant prevádzky nepotrebujú (vidia
 * všetky) — `workplaceIds` sa preň ignoruje, aj keby
 * ich niekto poslal. Zámerne BEZ `employees` riadku (manažér/owner/
 * accountant nemajú pozíciu/rozvrh) — na rozdiel od
 * `createEmployeeAccountAndInvite` teda niet čo prepájať späť, len `users`
 * + prípadne `manager_workplaces`.
 */
export async function createOwnerOrManagerAccountAndInvite(
  tx: Tx,
  params: { orgId: string; email: string; fullName: string; phone: string | null; role: "owner" | "manager" | "accountant"; workplaceIds: string[] },
): Promise<InviteOutcome> {
  const existing = await tx.select({ id: users.id }).from(users).where(eq(users.email, params.email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
  }

  const admin = createSupabaseAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/nastavit-heslo`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: { redirectTo },
  });

  if (error || !data.user) {
    return { ok: false, message: `Nepodarilo sa vytvoriť pozvánku: ${error?.message ?? "neznáma chyba"}` };
  }

  let newUserId: string;
  try {
    const [inserted] = await tx
      .insert(users)
      .values({
        orgId: params.orgId,
        authUserId: data.user.id,
        email: params.email,
        role: params.role,
        fullName: params.fullName,
        phone: params.phone,
        invitedAt: new Date(),
      })
      .returning({ id: users.id });
    newUserId = inserted.id;
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, message: "Tento email už patrí inému kontu v systéme." };
    }
    throw err;
  }

  if (params.role === "manager" && params.workplaceIds.length > 0) {
    await tx.insert(managerWorkplaces).values(params.workplaceIds.map((workplaceId) => ({ userId: newUserId, workplaceId })));
  }

  try {
    await sendEmail({
      to: params.email,
      subject: "Pozvánka do dochádzkového systému",
      html: inviteEmailHtml({ fullName: params.fullName, link: data.properties.action_link }),
    });
  } catch {
    return { ok: false, message: "Konto bolo vytvorené, ale odoslanie pozvánky zlyhalo. Skús to znova tlačidlom nižšie." };
  }

  return { ok: true };
}

/**
 * Znova pošle pozvánku už EXISTUJÚCEMU, ešte NEAKTIVOVANÉMU kontu — nový
 * `generateLink` (čerstvý odkaz/token), nie nový `users` riadok. Určené len
 * pre kontá, ktoré si zamestnanec ešte nenastavil heslom (volajúca stránka
 * to tlačidlo ukazuje len vtedy).
 */
export async function resendAccountInvite(
  tx: Tx,
  params: { userId: string; email: string; fullName: string },
): Promise<InviteOutcome> {
  const admin = createSupabaseAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/nastavit-heslo`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: { redirectTo },
  });

  if (error || !data.user) {
    return { ok: false, message: `Nepodarilo sa vytvoriť novú pozvánku: ${error?.message ?? "neznáma chyba"}` };
  }

  await tx.update(users).set({ invitedAt: new Date() }).where(eq(users.id, params.userId));

  try {
    await sendEmail({
      to: params.email,
      subject: "Pozvánka do dochádzkového systému",
      html: inviteEmailHtml({ fullName: params.fullName, link: data.properties.action_link }),
    });
  } catch {
    return { ok: false, message: "Odoslanie pozvánky zlyhalo. Skús to znova." };
  }

  return { ok: true };
}

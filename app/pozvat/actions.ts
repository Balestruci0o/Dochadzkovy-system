"use server";

import { eq } from "drizzle-orm";
import { requireRole, withCurrentUser } from "@/lib/auth/session";
import { users, userRoleEnum } from "@/lib/db/schema";
import { inviteEmailHtml } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type InviteState = { error?: string; success?: string };

const INVITABLE_ROLES = userRoleEnum.enumValues.filter((r) => r !== "owner");

export async function inviteUserAction(
  _prevState: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const inviter = await requireRole("owner", "manager");

  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const role = String(formData.get("role") ?? "employee");

  if (!email || !fullName) {
    return { error: "Vyplň meno aj email." };
  }

  if (!INVITABLE_ROLES.includes(role as (typeof INVITABLE_ROLES)[number])) {
    return { error: "Neplatná rola." };
  }

  // Manažér smie pozývať len zamestnancov — schvaľovanie ďalších manažérov
  // alebo účtovníčky patrí ownerovi. Vynútené aj v RLS (users_insert_manager).
  if (inviter.role === "manager" && role !== "employee") {
    return { error: "Ako manažér môžeš pozvať len zamestnanca." };
  }

  // Manažér vidí cez RLS (users_select_manager) len users riadky zamestnancov
  // vo svojich prevádzkach — takže tento check nemusí odhaliť email, ktorý už
  // patrí niekomu mimo jeho prevádzok (iný manažér, nepriradený zamestnanec).
  // To je v poriadku: skutočnú ochranu proti duplicite dáva UNIQUE(org_id,
  // email) v DB — chytáme ju nižšie ako pekné hlásenie namiesto pádu.
  const existing = await withCurrentUser((tx) =>
    tx.select().from(users).where(eq(users.email, email)).limit(1),
  );
  if (existing.length > 0) {
    return { error: "Používateľ s týmto emailom už existuje." };
  }

  const admin = createSupabaseAdminClient();
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/nastavit-heslo`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { redirectTo },
  });

  if (error || !data.user) {
    return { error: `Nepodarilo sa vytvoriť pozvánku: ${error?.message ?? "neznáma chyba"}` };
  }

  try {
    await withCurrentUser((tx) =>
      tx.insert(users).values({
        orgId: inviter.orgId,
        authUserId: data.user.id,
        email,
        role: role as (typeof INVITABLE_ROLES)[number],
        fullName,
        invitedAt: new Date(),
      }),
    );
  } catch (err) {
    const isUniqueViolation =
      err instanceof Error &&
      /duplicate key value violates unique constraint/.test(
        String((err as { cause?: unknown }).cause ?? err.message),
      );
    if (isUniqueViolation) {
      return { error: "Používateľ s týmto emailom už existuje." };
    }
    throw err;
  }

  await sendEmail({
    to: email,
    subject: "Pozvánka do dochádzkového systému",
    html: inviteEmailHtml({ fullName, link: data.properties.action_link }),
  });

  return { success: `Pozvánka pre ${fullName} bola odoslaná.` };
}

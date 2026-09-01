"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { resolvePostAuthRedirect } from "@/lib/auth/mfa";
import { validatePassword } from "@/lib/auth/password";
import { withUserContext } from "@/lib/db";
// eslint-disable-next-line no-restricted-imports -- bootstrap: pred týmto lookupom nepoznáme users.id, takže nemáme čo dať do app.user_id (docs/ARCHITECTURE.md, kategória A)
import { adminDb } from "@/lib/db/admin";
import { users } from "@/lib/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SetPasswordState = { error?: string };

export async function setPasswordAction(
  _prevState: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (password !== passwordConfirm) {
    return { error: "Heslá sa nezhodujú." };
  }

  const check = await validatePassword(password);
  if (!check.valid) {
    return { error: check.error };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: getUserError,
  } = await supabase.auth.getUser();

  if (getUserError || !user) {
    redirect("/prihlasenie");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return {
      error: "Nepodarilo sa nastaviť heslo. Skús to znova alebo si vyžiadaj nový odkaz.",
    };
  }

  const [row] = await adminDb.select().from(users).where(eq(users.authUserId, user.id)).limit(1);
  if (row && !row.activatedAt) {
    await withUserContext(row.id, (tx) =>
      tx.update(users).set({ activatedAt: new Date() }).where(eq(users.id, row.id)),
    );
  }

  redirect(
    await resolvePostAuthRedirect(
      supabase,
      { id: row?.id ?? "", role: row?.role ?? "employee", email: row?.email ?? "", fullName: row?.fullName ?? "" },
      next,
    ),
  );
}

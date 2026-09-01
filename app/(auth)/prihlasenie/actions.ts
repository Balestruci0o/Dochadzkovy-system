"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolvePostAuthRedirect } from "@/lib/auth/mfa";
import { checkLoginRateLimit, recordLoginEvent } from "@/lib/auth/rate-limit";
import { withUserContext } from "@/lib/db";
// eslint-disable-next-line no-restricted-imports -- bootstrap: pred týmto lookupom nepoznáme users.id, takže nemáme čo dať do app.user_id (docs/ARCHITECTURE.md, kategória A)
import { adminDb } from "@/lib/db/admin";
import { users } from "@/lib/db/schema";
import { getClientIp } from "@/lib/shared/client-ip";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = { error?: string };

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");

  if (!email || !password) {
    return { error: "Vyplň email aj heslo." };
  }

  const h = await headers();
  const ip = getClientIp(h);
  const userAgent = h.get("user-agent");

  const rateLimit = await checkLoginRateLimit(email, ip);
  if (!rateLimit.allowed) {
    await recordLoginEvent({ emailTried: email, success: false, ip, userAgent });
    return { error: rateLimit.reason };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    await recordLoginEvent({ emailTried: email, success: false, ip, userAgent });
    return { error: "Nesprávny email alebo heslo." };
  }

  const [row] = await adminDb.select().from(users).where(eq(users.authUserId, data.user.id)).limit(1);
  // `row.email === null` je prakticky nedosiahnuteľné — soft-delete vynuluje
  // `authUserId` aj Supabase Auth účet zároveň, takže zmazané konto by sa sem
  // vôbec nedostalo (fail-safe, nie fail-open).
  if (!row || !row.isActive || row.email === null) {
    await supabase.auth.signOut();
    await recordLoginEvent({ emailTried: email, success: false, ip, userAgent });
    return { error: "Účet neexistuje alebo je deaktivovaný." };
  }

  // Tri nezávislé operácie (žiadna nepotrebuje výsledok inej) — bežia
  // súbežne namiesto postupne, aby prihlásenie neplatilo tri sekvenčné
  // sieťové cesty namiesto jednej.
  const [, , dest] = await Promise.all([
    recordLoginEvent({ userId: row.id, emailTried: email, success: true, ip, userAgent }),
    withUserContext(row.id, (tx) =>
      tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id)),
    ),
    resolvePostAuthRedirect(supabase, { id: row.id, role: row.role, email: row.email, fullName: row.fullName }, next),
  ]);

  redirect(dest);
}

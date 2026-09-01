import { decodeJwt } from "jose";
import { ensureEmailOtpSent, hasVerifiedEmailOtp } from "@/lib/auth/email-otp";
import { getLandingPath } from "@/lib/auth/landing";
import type { UserRole } from "@/lib/auth/session";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * DEV_DISABLE_2FA — len pre lokálny vývoj, kým nefunguje mail/doména a nedá sa
 * pohodlne prechádzať 2FA pri každom prihlásení. Tvrdo ignorované v produkcii
 * bez ohľadu na to, či premenná ostala nastavená — nesmie závisieť od toho, že
 * si to niekto pamätá odstrániť. Rovnaký vzor ako DEV_ACCOUNTS_PASSWORD
 * (lib/db/dev-accounts.ts). Samotný 2FA kód (issue/verify) ostáva funkčný —
 * toto len obchádza jeho vynútenie pri prihlásení.
 */
function isDev2faDisabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEV_DISABLE_2FA === "true";
}

/**
 * `session_id` claim zo Supabase JWT — stabilný po celú dobu JEDNEJ
 * prihlásenej session (prežije token refresh), mení sa len pri novom
 * prihlásení. `decodeJwt` NEOVERUJE podpis (len parsuje claims) — bezpečné
 * tu, lebo token pochádza priamo z NÁŠHO servrového Supabase klienta, ktorý
 * session už overil cez cookies; nejde o cudzí/nedôveryhodný vstup.
 */
export async function getSupabaseSessionId(supabase: SupabaseServerClient): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) return null;
  try {
    const payload = decodeJwt(session.access_token);
    return typeof payload.session_id === "string" ? payload.session_id : null;
  } catch {
    return null;
  }
}

/**
 * Kam presmerovať po úspešnom prihlásení/nastavení hesla, s ohľadom na 2FA:
 * - iná rola než owner → vždy rovno dnu, žiadny druhý krok
 * - owner, ktorého TÁTO session (session_id) ešte neoverila email-OTP kód →
 *   vydá/pošle kód (ensureEmailOtpSent, idempotentné) a presmeruje na
 *   `/2fa/overit`
 * - inak → pôvodný cieľ (`next`), alebo rovno domovská stránka danej role,
 *   ak `next` nemieri nikam konkrétne (default "/"). Bez tohto by KAŽDÉ
 *   prihlásenie robilo dva skoky (login → "/" → rolou-špecifická stránka),
 *   a keďže "/" leží mimo (app) layoutu, druhý skok vynucoval tvrdý reload
 *   namiesto client-side prechodu — zbytočná latencia navyše.
 */
export async function resolvePostAuthRedirect(
  supabase: SupabaseServerClient,
  user: { id: string; role: UserRole; email: string; fullName: string },
  next: string,
): Promise<string> {
  if (isDev2faDisabled() || user.role !== "owner") {
    return next && next !== "/" ? next : getLandingPath(user.role);
  }

  const sessionId = await getSupabaseSessionId(supabase);
  if (sessionId) {
    const verified = await hasVerifiedEmailOtp(user.id, sessionId);
    if (verified) {
      return next && next !== "/" ? next : getLandingPath(user.role);
    }
    await ensureEmailOtpSent({ userId: user.id, sessionId, email: user.email, fullName: user.fullName });
  }

  return `/2fa/overit?next=${encodeURIComponent(next)}`;
}

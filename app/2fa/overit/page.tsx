import { redirect } from "next/navigation";
import { ensureEmailOtpSent, hasVerifiedEmailOtp } from "@/lib/auth/email-otp";
import { getLandingPath } from "@/lib/auth/landing";
import { getSupabaseSessionId } from "@/lib/auth/mfa";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VerifyForm } from "./verify-form";

export default async function Overit2faPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await requireUser();

  // Iná rola než owner sem nemá čo hľadať (2FA je len pre owner) — pošli ju
  // rovno na jej domovskú stránku namiesto chyby.
  if (user.role !== "owner") {
    redirect(next || getLandingPath(user.role));
  }

  const supabase = await createSupabaseServerClient();
  const sessionId = await getSupabaseSessionId(supabase);
  if (!sessionId) {
    // Krajne nezvyčajné (session bez session_id claimu) — bez neho sa kód
    // nedá naviazať na túto konkrétnu session, najbezpečnejšie je nové prihlásenie.
    redirect("/prihlasenie");
  }

  if (await hasVerifiedEmailOtp(user.id, sessionId)) {
    redirect(next || getLandingPath(user.role));
  }

  // Zabezpečí platný kód aj vtedy, keď sem niekto príde priamo (bez toho, aby
  // resolvePostAuthRedirect stihlo kód poslať) alebo sa vráti po vypršaní
  // pôvodného — idempotentné, nepošle druhý mail, kým prvý ešte platí.
  await ensureEmailOtpSent({ userId: user.id, sessionId, email: user.email, fullName: user.fullName });

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-8 shadow-sm">
        <h1 className="font-serif text-2xl font-bold text-ink">Overenie prihlásenia</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          Poslali sme ti 6-miestny kód na email <b>{user.email}</b>. Platí 10 minút.
        </p>
        <VerifyForm next={next} />
      </div>
    </div>
  );
}

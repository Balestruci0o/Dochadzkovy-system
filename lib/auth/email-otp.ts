import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { emailOtpCodes } from "@/lib/db/schema";
import { otpCodeEmailHtml } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { checkOtpRateLimit, recordOtpAttempt } from "./email-otp-rate-limit";

/**
 * 2FA (owner-only) — jednorazový 6-miestny kód mailom namiesto TOTP.
 *
 * `sessionId` je claim `session_id` zo Supabase JWT (viď `getSupabaseSessionId`
 * nižšie) — rovnaký po celú dobu JEDNEJ prihlásenej session (prežije refresh
 * tokenu), mení sa len pri novom prihlásení. Kód/overenie je naviazané naň,
 * nie na `userId` samotné: raz overená session zostáva overená (rovnaké
 * správanie ako predošlé Supabase AAL2 — "over raz za session", nie pri
 * každom requeste), ale NOVÉ prihlásenie si vždy vyžiada nový kód.
 */

const CODE_TTL_MINUTES = 10;

function generateCode(): string {
  // crypto.randomInt (CSPRNG), nikdy Math.random — kód je krátkodobé
  // prihlasovacie tajomstvo, nie kozmetický token.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Už bola TÁTO session (userId+sessionId) niekedy úspešne overená kódom? */
export async function hasVerifiedEmailOtp(userId: string, sessionId: string): Promise<boolean> {
  const [row] = await adminDb
    .select({ id: emailOtpCodes.id })
    .from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.userId, userId), eq(emailOtpCodes.sessionId, sessionId), isNotNull(emailOtpCodes.usedAt)))
    .limit(1);
  return !!row;
}

/**
 * Zabezpečí, že pre (userId, sessionId) existuje PLATNÝ, ešte nepoužitý kód —
 * ak už jeden čaká (nevypršal, nepoužitý), NEPOŠLE nový mail (idempotentné
 * voči opakovanému volaniu/refreshu stránky); inak vygeneruje nový, uloží
 * hash a pošle mailom. Volá ju aj `resolvePostAuthRedirect` (hneď po
 * prihlásení), aj `/2fa/overit` stránka (pri návšteve/reloade).
 */
export async function ensureEmailOtpSent(params: {
  userId: string;
  sessionId: string;
  email: string;
  fullName: string;
}): Promise<void> {
  const { userId, sessionId, email, fullName } = params;

  const [pending] = await adminDb
    .select({ id: emailOtpCodes.id })
    .from(emailOtpCodes)
    .where(
      and(
        eq(emailOtpCodes.userId, userId),
        eq(emailOtpCodes.sessionId, sessionId),
        isNull(emailOtpCodes.usedAt),
        gt(emailOtpCodes.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (pending) return;

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await adminDb.insert(emailOtpCodes).values({ userId, sessionId, codeHash: hashCode(code), expiresAt });

  await sendEmail({
    to: email,
    subject: "Prihlasovací kód",
    html: otpCodeEmailHtml({ fullName, code, ttlMinutes: CODE_TTL_MINUTES }),
  });
}

export type VerifyEmailOtpResult = { ok: true } | { ok: false; error: string };

/**
 * Overí zadaný kód pre (userId, sessionId). Poradie: rate limit → nájdi
 * najnovší nepoužitý kód tejto session → over expiráciu → porovnaj hash →
 * pri zhode označ ako použitý (jednorazovosť). Každý pokus (úspešný aj
 * neúspešný) sa zaloguje pre rate limiting, PRED vrátením výsledku.
 */
export async function verifyEmailOtp(params: {
  userId: string;
  sessionId: string;
  code: string;
  ip: string | null;
}): Promise<VerifyEmailOtpResult> {
  const { userId, sessionId, code, ip } = params;

  const rateLimit = await checkOtpRateLimit(userId, ip);
  if (!rateLimit.allowed) {
    await recordOtpAttempt({ userId, success: false, ip });
    return { ok: false, error: rateLimit.reason };
  }

  const [row] = await adminDb
    .select()
    .from(emailOtpCodes)
    .where(and(eq(emailOtpCodes.userId, userId), eq(emailOtpCodes.sessionId, sessionId), isNull(emailOtpCodes.usedAt)))
    .orderBy(desc(emailOtpCodes.createdAt))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    await recordOtpAttempt({ userId, success: false, ip });
    return { ok: false, error: "Kód vypršal alebo neexistuje. Prihlás sa znova." };
  }

  const match = hashCode(code) === row.codeHash;
  await recordOtpAttempt({ userId, success: match, ip });

  if (!match) {
    return { ok: false, error: "Nesprávny kód." };
  }

  await adminDb.update(emailOtpCodes).set({ usedAt: new Date() }).where(eq(emailOtpCodes.id, row.id));
  return { ok: true };
}

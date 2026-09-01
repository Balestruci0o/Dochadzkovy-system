import { and, eq, gt, sql } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { emailOtpAttempts } from "@/lib/db/schema";

/**
 * Rate limiting na overovanie email-OTP kódu (2FA, owner-only) — rovnaký
 * DB-based vzor ako `lib/auth/rate-limit.ts` (login_events), nie
 * Upstash/Redis. Samostatná tabuľka (`email_otp_attempts`), nie zdieľaná s
 * login_events — iný krok prihlásenia, iný útočný scenár (uhádnutie
 * 6-miestneho kódu, nie hesla).
 *
 * Obe kontroly (userId, IP) bežia súbežne (Promise.all), nezávisle od seba.
 */

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_PER_USER = 5;
const MAX_ATTEMPTS_PER_IP = 20;

export type OtpRateLimitResult = { allowed: true } | { allowed: false; reason: string };

export async function checkOtpRateLimit(userId: string, ip: string | null): Promise<OtpRateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const [[byUser], byIp] = await Promise.all([
    adminDb
      .select({ count: sql<number>`count(*)` })
      .from(emailOtpAttempts)
      .where(and(eq(emailOtpAttempts.userId, userId), eq(emailOtpAttempts.success, false), gt(emailOtpAttempts.createdAt, since))),
    ip
      ? adminDb
          .select({ count: sql<number>`count(*)` })
          .from(emailOtpAttempts)
          .where(and(eq(emailOtpAttempts.ip, ip), eq(emailOtpAttempts.success, false), gt(emailOtpAttempts.createdAt, since)))
      : Promise.resolve([{ count: 0 }]),
  ]);

  if (Number(byUser.count) >= MAX_ATTEMPTS_PER_USER) {
    return { allowed: false, reason: "Príliš veľa neúspešných pokusov. Skús to znova o pár minút." };
  }

  if (Number(byIp[0].count) >= MAX_ATTEMPTS_PER_IP) {
    return { allowed: false, reason: "Príliš veľa neúspešných pokusov z tejto siete. Skús to znova neskôr." };
  }

  return { allowed: true };
}

export async function recordOtpAttempt(params: { userId: string; success: boolean; ip?: string | null }) {
  await adminDb.insert(emailOtpAttempts).values({
    userId: params.userId,
    success: params.success,
    ip: params.ip ?? null,
  });
}

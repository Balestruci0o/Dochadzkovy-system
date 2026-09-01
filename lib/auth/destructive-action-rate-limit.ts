import { and, eq, gt, sql } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { destructiveActionAttempts } from "@/lib/db/schema";

/**
 * Rate limiting na overovanie potvrdzovacieho kódu pri mazaní (Blok 14) —
 * rovnaký DB-based vzor ako `lib/auth/email-otp-rate-limit.ts` (2FA), ale
 * VLASTNÁ tabuľka. Zdieľanie s prihlasovacím 2FA by znamenalo, že séria
 * neúspešných potvrdení mazania môže zamknúť majiteľa aj z PRIHLÁSENIA —
 * iný krok, iný útočný scenár, samostatný limit.
 */

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_PER_USER = 5;
const MAX_ATTEMPTS_PER_IP = 20;

export type DestructiveActionRateLimitResult = { allowed: true } | { allowed: false; reason: string };

export async function checkDestructiveActionRateLimit(userId: string, ip: string | null): Promise<DestructiveActionRateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const [[byUser], byIp] = await Promise.all([
    adminDb
      .select({ count: sql<number>`count(*)` })
      .from(destructiveActionAttempts)
      .where(and(eq(destructiveActionAttempts.userId, userId), eq(destructiveActionAttempts.success, false), gt(destructiveActionAttempts.createdAt, since))),
    ip
      ? adminDb
          .select({ count: sql<number>`count(*)` })
          .from(destructiveActionAttempts)
          .where(and(eq(destructiveActionAttempts.ip, ip), eq(destructiveActionAttempts.success, false), gt(destructiveActionAttempts.createdAt, since)))
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

export async function recordDestructiveActionAttempt(params: { userId: string; success: boolean; ip?: string | null }) {
  await adminDb.insert(destructiveActionAttempts).values({
    userId: params.userId,
    success: params.success,
    ip: params.ip ?? null,
  });
}

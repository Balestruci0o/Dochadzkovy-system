import { and, eq, gt, sql } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { loginEvents } from "@/lib/db/schema";

/**
 * Rate limiting na login cez DB (login_events), nie Upstash Redis —
 * docs/ARCHITECTURE.md ho spomína, ale ten účet zatiaľ nemáme. Pri menšom
 * nasadení a jednej appke toto stačí; presun na Redis je len otázka
 * škálovania naprieč viacerými serverless inštanciami.
 *
 * Zápis login_events ide VÝHRADNE cez adminDb: neúspešný pokus prihlásenia
 * ešte nemá žiadnu identitu (app.user_id), takže RLS by INSERT aj tak
 * nepustil (a app_user na login_events INSERT/UPDATE/DELETE grant ani nemá,
 * viď lib/db/migrations/0004_full_rls_coverage.sql).
 *
 * Obe kontroly (email, IP) sú na sebe nezávislé — bežia súbežne
 * (Promise.all), nie postupne, aby prihlásenie neplatilo dve sekvenčné
 * sieťové cesty k DB namiesto jednej.
 */

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS_PER_EMAIL = 5;
const MAX_ATTEMPTS_PER_IP = 20;

export type RateLimitResult = { allowed: true } | { allowed: false; reason: string };

export async function checkLoginRateLimit(
  email: string,
  ip: string | null,
): Promise<RateLimitResult> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000);

  const [[byEmail], byIp] = await Promise.all([
    adminDb
      .select({ count: sql<number>`count(*)` })
      .from(loginEvents)
      .where(
        and(
          eq(loginEvents.emailTried, email),
          eq(loginEvents.success, false),
          gt(loginEvents.createdAt, since),
        ),
      ),
    ip
      ? adminDb
          .select({ count: sql<number>`count(*)` })
          .from(loginEvents)
          .where(
            and(eq(loginEvents.ip, ip), eq(loginEvents.success, false), gt(loginEvents.createdAt, since)),
          )
      : Promise.resolve([{ count: 0 }]),
  ]);

  if (Number(byEmail.count) >= MAX_ATTEMPTS_PER_EMAIL) {
    return {
      allowed: false,
      reason: "Príliš veľa neúspešných pokusov. Skús to znova o pár minút.",
    };
  }

  if (Number(byIp[0].count) >= MAX_ATTEMPTS_PER_IP) {
    return {
      allowed: false,
      reason: "Príliš veľa neúspešných pokusov z tejto siete. Skús to znova neskôr.",
    };
  }

  return { allowed: true };
}

export async function recordLoginEvent(params: {
  userId?: string | null;
  emailTried: string;
  success: boolean;
  ip?: string | null;
  userAgent?: string | null;
}) {
  await adminDb.insert(loginEvents).values({
    userId: params.userId ?? null,
    emailTried: params.emailTried,
    success: params.success,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  });
}

import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { adminDb } from "@/lib/db/admin";
import { destructiveActionCodes } from "@/lib/db/schema";
import { destructiveActionCodeEmailHtml } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/resend";
import { checkDestructiveActionRateLimit, recordDestructiveActionAttempt } from "./destructive-action-rate-limit";

/**
 * Blok 14 — mazanie konfigurácie/zamestnancov, potvrdené jednorazovým kódom
 * mailom (rovnaký mechanizmus ako 2FA, `lib/auth/email-otp.ts`, ale
 * SAMOSTATNÝ — viď schema.ts). Na rozdiel od 2FA (kód platí pre CELÚ
 * session) je kód tu viazaný na KONKRÉTNY cieľ mazania (`targetType` +
 * `targetId`) — overenie jedného mazania neplatí pre iné, presne "každé
 * mazanie potvrdí kódom z mailu".
 */

const CODE_TTL_MINUTES = 10;

export type DestructiveActionTargetType =
  | "legal_rule"
  | "coverage_requirement"
  | "shift_template"
  | "position"
  | "workplace"
  | "employee"
  | "user_account";

function generateCode(): string {
  // crypto.randomInt (CSPRNG), nikdy Math.random — rovnaký dôvod ako pri 2FA.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Vždy vydá a pošle NOVÝ kód (na rozdiel od 2FA `ensureEmailOtpSent`, ktoré
 * tichο vráti existujúci nepoužitý) — žiadosť o zmazanie sa dá kedykoľvek
 * zrušiť a spustiť odznova, netreba čakať na vypršanie predošlého kódu.
 */
export async function sendDestructiveActionCode(params: {
  userId: string;
  targetType: DestructiveActionTargetType;
  targetId: string;
  email: string;
  fullName: string;
  actionLabel: string;
}): Promise<void> {
  const { userId, targetType, targetId, email, fullName, actionLabel } = params;

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);

  await adminDb.insert(destructiveActionCodes).values({ userId, targetType, targetId, codeHash: hashCode(code), expiresAt });

  await sendEmail({
    to: email,
    subject: "Potvrdenie zmazania",
    html: destructiveActionCodeEmailHtml({ fullName, code, ttlMinutes: CODE_TTL_MINUTES, actionLabel }),
  });
}

export type VerifyDestructiveActionResult = { ok: true } | { ok: false; error: string };

/**
 * Overí kód pre PRESNE tento (userId, targetType, targetId) — kód vydaný pre
 * iný cieľ (aj toho istého typu) nikdy neprejde. Volajúca server action MUSÍ
 * až PO úspešnom `{ ok: true }` vykonať samotné mazanie — táto funkcia sama
 * nič nemaže, len označí kód ako použitý.
 */
export async function verifyDestructiveActionCode(params: {
  userId: string;
  targetType: DestructiveActionTargetType;
  targetId: string;
  code: string;
  ip: string | null;
}): Promise<VerifyDestructiveActionResult> {
  const { userId, targetType, targetId, code, ip } = params;

  const rateLimit = await checkDestructiveActionRateLimit(userId, ip);
  if (!rateLimit.allowed) {
    await recordDestructiveActionAttempt({ userId, success: false, ip });
    return { ok: false, error: rateLimit.reason };
  }

  const [row] = await adminDb
    .select()
    .from(destructiveActionCodes)
    .where(
      and(
        eq(destructiveActionCodes.userId, userId),
        eq(destructiveActionCodes.targetType, targetType),
        eq(destructiveActionCodes.targetId, targetId),
        isNull(destructiveActionCodes.usedAt),
      ),
    )
    .orderBy(desc(destructiveActionCodes.createdAt))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    await recordDestructiveActionAttempt({ userId, success: false, ip });
    return { ok: false, error: "Kód vypršal alebo neexistuje. Vyžiadaj si nový." };
  }

  const match = hashCode(code) === row.codeHash;
  await recordDestructiveActionAttempt({ userId, success: match, ip });

  if (!match) {
    return { ok: false, error: "Nesprávny kód." };
  }

  await adminDb.update(destructiveActionCodes).set({ usedAt: new Date() }).where(eq(destructiveActionCodes.id, row.id));
  return { ok: true };
}

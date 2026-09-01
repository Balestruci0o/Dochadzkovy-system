import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { emailOtpAttempts, emailOtpCodes, users } from "@/lib/db/schema";
import { testOrg } from "@/lib/db/test-fixture";
import { ensureEmailOtpSent, hasVerifiedEmailOtp, verifyEmailOtp } from "./email-otp";

const sendEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/resend", () => ({ sendEmail: (...args: unknown[]) => sendEmailMock(...args) }));

/**
 * 2FA (owner-only, email kód namiesto TOTP) — nahrádza Supabase auth.mfa.
 * `sendEmail` je mockovaný (vi.mock), nech testy nepošlú reálny mail cez
 * Resend. Jeden zdieľaný owner (rovnaký vzor ako inde v sade, viď testOrg) —
 * izolácia medzi testami ide cez UNIKÁTNY `sessionId` na test, nie cez
 * samostatného usera.
 */

const org = testOrg("email-otp-test");
let userId: string;

beforeAll(async () => {
  const [user] = await adminDb
    .insert(users)
    .values({ orgId: org.id, email: `otp-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Test Owner" })
    .returning();
  userId = user.id;
});

beforeEach(() => {
  sendEmailMock.mockClear();
});

describe("ensureEmailOtpSent", () => {
  it("prvé volanie pošle mail a vytvorí kód; druhé (kým platí) NEPOŠLE druhý mail (idempotentné)", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // stále 1, nie 2

    const rows = await adminDb.select().from(emailOtpCodes).where(eq(emailOtpCodes.sessionId, sessionId));
    expect(rows).toHaveLength(1);
  });

  it("kód v maily je 6-miestne číslo (crypto.randomInt), nie prázdny/kratší reťazec", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });
    const call = sendEmailMock.mock.calls[0][0] as { html: string };
    const match = call.html.match(/(\d{6})/);
    expect(match).not.toBeNull();
  });
});

describe("verifyEmailOtp — expirácia, jednorazovosť, nesprávny kód", () => {
  it("nesprávny kód je zamietnutý, hasVerifiedEmailOtp ostáva false", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });

    const result = await verifyEmailOtp({ userId, sessionId, code: "000000", ip: "203.0.113.1" });
    // pravdepodobnosť náhodnej zhody so skutočným kódom je 1/1 000 000 — zanedbateľné
    expect(result.ok).toBe(false);
    expect(await hasVerifiedEmailOtp(userId, sessionId)).toBe(false);
  });

  it("správny kód overí session; ten istý kód POUŽITÝ DRUHÝKRÁT už neplatí (jednorazovosť)", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });
    const call = sendEmailMock.mock.calls[0][0] as { html: string };
    const code = call.html.match(/(\d{6})/)![1];

    const first = await verifyEmailOtp({ userId, sessionId, code, ip: "203.0.113.1" });
    expect(first.ok).toBe(true);
    expect(await hasVerifiedEmailOtp(userId, sessionId)).toBe(true);

    const second = await verifyEmailOtp({ userId, sessionId, code, ip: "203.0.113.1" });
    expect(second.ok).toBe(false);
  });

  it("vypršaný kód je zamietnutý aj so správnou hodnotou", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });
    const call = sendEmailMock.mock.calls[0][0] as { html: string };
    const code = call.html.match(/(\d{6})/)![1];

    // simuluj vypršanie priamo v DB (posunutie expiresAt do minulosti)
    await adminDb.update(emailOtpCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(emailOtpCodes.sessionId, sessionId));

    const result = await verifyEmailOtp({ userId, sessionId, code, ip: "203.0.113.1" });
    expect(result.ok).toBe(false);
  });

  it("iná session (iný session_id) toho istého ownera je NEZÁVISLÁ — neoverená session zostáva neoverená", async () => {
    const sessionA = `sess-a-${crypto.randomUUID()}`;
    const sessionB = `sess-b-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId: sessionA, email: "test@example.com", fullName: "Test Owner" });
    const call = sendEmailMock.mock.calls[0][0] as { html: string };
    const code = call.html.match(/(\d{6})/)![1];

    await verifyEmailOtp({ userId, sessionId: sessionA, code, ip: "203.0.113.1" });

    expect(await hasVerifiedEmailOtp(userId, sessionA)).toBe(true);
    expect(await hasVerifiedEmailOtp(userId, sessionB)).toBe(false);
  });

  it("neúspešný pokus sa zaloguje do email_otp_attempts (rate limiting)", async () => {
    const sessionId = `sess-${crypto.randomUUID()}`;
    await ensureEmailOtpSent({ userId, sessionId, email: "test@example.com", fullName: "Test Owner" });
    const before = await adminDb.select().from(emailOtpAttempts).where(eq(emailOtpAttempts.userId, userId));
    await verifyEmailOtp({ userId, sessionId, code: "000000", ip: "203.0.113.1" });

    const after = await adminDb.select().from(emailOtpAttempts).where(eq(emailOtpAttempts.userId, userId));
    expect(after.length).toBe(before.length + 1);
    expect(after.some((a) => a.success === false)).toBe(true);
  });
});

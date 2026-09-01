import { afterEach, describe, expect, it, vi } from "vitest";
import * as emailOtp from "./email-otp";
import { resolvePostAuthRedirect } from "./mfa";

/**
 * DEV_DISABLE_2FA — musí obísť vynútenie 2FA v dev, ale NIKDY v produkcii, aj
 * keby premenná ostala nastavená (bezpečnostné poistky nesmú závisieť od
 * toho, že si niekto spomenie ich odstrániť).
 *
 * 2FA (email-OTP, owner-only) — `hasVerifiedEmailOtp`/`ensureEmailOtpSent` sa
 * mockujú namiesto reálnej DB (čistá rozhodovacia logika `resolvePostAuthRedirect`
 * sa testuje nezávisle od `lib/auth/email-otp.ts`, ktoré má vlastné testy).
 */

const OWNER = { id: "owner-1", role: "owner" as const, email: "owner@example.com", fullName: "Owner Ownerovič" };
const MANAGER = { id: "mgr-1", role: "manager" as const, email: "mgr@example.com", fullName: "Manažér Manažérovič" };

function fakeSupabase(sessionId: string | null) {
  const getSession = vi.fn().mockResolvedValue({
    data: { session: sessionId ? { access_token: fakeToken(sessionId) } : null },
  });
  return { auth: { getSession } } as unknown as Parameters<typeof resolvePostAuthRedirect>[0];
}

/** Minimálny JWT (hlavička.payload.podpis) — decodeJwt overuje len tvar, nie podpis. */
function fakeToken(sessionId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
  return `${header}.${payload}.`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("resolvePostAuthRedirect — DEV_DISABLE_2FA", () => {
  it("mimo produkcie s DEV_DISABLE_2FA=true úplne obíde 2FA (owner ide rovno na landing, žiadne volanie na email-otp)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_DISABLE_2FA", "true");
    const ensureSpy = vi.spyOn(emailOtp, "ensureEmailOtpSent");

    const dest = await resolvePostAuthRedirect(fakeSupabase("sess-1"), OWNER, "/");

    expect(dest).toBe("/dnes");
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it("v produkcii IGNORUJE DEV_DISABLE_2FA=true — owner bez overenej session musí aj tak na /2fa/overit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_DISABLE_2FA", "true");
    vi.spyOn(emailOtp, "hasVerifiedEmailOtp").mockResolvedValue(false);
    const ensureSpy = vi.spyOn(emailOtp, "ensureEmailOtpSent").mockResolvedValue();

    const dest = await resolvePostAuthRedirect(fakeSupabase("sess-1"), OWNER, "/");

    expect(dest).toBe("/2fa/overit?next=%2F");
    expect(ensureSpy).toHaveBeenCalledWith({ userId: OWNER.id, sessionId: "sess-1", email: OWNER.email, fullName: OWNER.fullName });
  });

  it("bez DEV_DISABLE_2FA sa 2FA vynucuje normálne (owner bez overenej session → /2fa/overit, kód sa pošle)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_DISABLE_2FA", "");
    vi.spyOn(emailOtp, "hasVerifiedEmailOtp").mockResolvedValue(false);
    const ensureSpy = vi.spyOn(emailOtp, "ensureEmailOtpSent").mockResolvedValue();

    const dest = await resolvePostAuthRedirect(fakeSupabase("sess-2"), OWNER, "/dnes");

    expect(dest).toBe("/2fa/overit?next=%2Fdnes");
    expect(ensureSpy).toHaveBeenCalledOnce();
  });
});

describe("resolvePostAuthRedirect — role", () => {
  it("iná rola než owner (manager/employee/accountant) ide VŽDY rovno dnu, žiadny email-OTP krok", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const ensureSpy = vi.spyOn(emailOtp, "ensureEmailOtpSent");

    const dest = await resolvePostAuthRedirect(fakeSupabase("sess-3"), MANAGER, "/");

    expect(dest).toBe("/dnes");
    expect(ensureSpy).not.toHaveBeenCalled();
  });
});

describe("resolvePostAuthRedirect — owner s už overenou session", () => {
  it("owner, ktorého TÁTO session (session_id) už email-OTP overila, ide rovno dnu bez nového kódu", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(emailOtp, "hasVerifiedEmailOtp").mockResolvedValue(true);
    const ensureSpy = vi.spyOn(emailOtp, "ensureEmailOtpSent");

    const dest = await resolvePostAuthRedirect(fakeSupabase("sess-verified"), OWNER, "/dnes");

    expect(dest).toBe("/dnes");
    expect(ensureSpy).not.toHaveBeenCalled();
  });
});

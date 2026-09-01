import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { loginEvents } from "@/lib/db/schema";
import { checkLoginRateLimit, recordLoginEvent } from "./rate-limit";

const TEST_EMAIL = `rate-limit-test-${crypto.randomUUID()}@test.local`;
const TEST_IP = "203.0.113.42";

afterEach(async () => {
  await adminDb.delete(loginEvents).where(eq(loginEvents.emailTried, TEST_EMAIL));
});

describe("checkLoginRateLimit", () => {
  it("povolí prihlásenie bez predchádzajúcich pokusov", async () => {
    const result = await checkLoginRateLimit(TEST_EMAIL, TEST_IP);
    expect(result.allowed).toBe(true);
  });

  it("zablokuje po 5 neúspešných pokusoch s tým istým emailom", async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginEvent({ emailTried: TEST_EMAIL, success: false, ip: TEST_IP });
    }

    const result = await checkLoginRateLimit(TEST_EMAIL, TEST_IP);
    expect(result.allowed).toBe(false);
  });

  it("úspešné prihlásenie sa do limitu nepočíta", async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginEvent({ emailTried: TEST_EMAIL, success: true, ip: TEST_IP });
    }

    const result = await checkLoginRateLimit(TEST_EMAIL, TEST_IP);
    expect(result.allowed).toBe(true);
  });

  it("iný email z tej istej IP nie je zablokovaný neúspechmi prvého emailu (pod prahom pre IP)", async () => {
    for (let i = 0; i < 5; i++) {
      await recordLoginEvent({ emailTried: TEST_EMAIL, success: false, ip: TEST_IP });
    }

    const otherEmail = `rate-limit-test-other-${crypto.randomUUID()}@test.local`;
    const result = await checkLoginRateLimit(otherEmail, TEST_IP);
    expect(result.allowed).toBe(true);

    await adminDb.delete(loginEvents).where(eq(loginEvents.emailTried, otherEmail));
  });
});

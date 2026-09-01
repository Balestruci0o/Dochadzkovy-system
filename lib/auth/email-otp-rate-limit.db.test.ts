import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { emailOtpAttempts, users } from "@/lib/db/schema";
import { testOrg } from "@/lib/db/test-fixture";
import { checkOtpRateLimit, recordOtpAttempt } from "./email-otp-rate-limit";

const org = testOrg("email-otp-rate-limit-test");
let userId: string;
const TEST_IP = "203.0.113.77";

beforeAll(async () => {
  const [user] = await adminDb
    .insert(users)
    .values({ orgId: org.id, email: `otp-rl-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Test Owner" })
    .returning();
  userId = user.id;
});

describe("checkOtpRateLimit", () => {
  it("povolí overenie bez predchádzajúcich pokusov", async () => {
    const result = await checkOtpRateLimit(userId, TEST_IP);
    expect(result.allowed).toBe(true);
  });

  it("zablokuje po 5 neúspešných pokusoch toho istého usera", async () => {
    const freshUserId = (
      await adminDb
        .insert(users)
        .values({ orgId: org.id, email: `otp-rl-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Test Owner 2" })
        .returning()
    )[0].id;

    for (let i = 0; i < 5; i++) {
      await recordOtpAttempt({ userId: freshUserId, success: false, ip: TEST_IP });
    }

    const result = await checkOtpRateLimit(freshUserId, TEST_IP);
    expect(result.allowed).toBe(false);
  });

  it("úspešný pokus sa do limitu nepočíta", async () => {
    const freshUserId = (
      await adminDb
        .insert(users)
        .values({ orgId: org.id, email: `otp-rl-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Test Owner 3" })
        .returning()
    )[0].id;

    for (let i = 0; i < 5; i++) {
      await recordOtpAttempt({ userId: freshUserId, success: true, ip: TEST_IP });
    }

    const result = await checkOtpRateLimit(freshUserId, TEST_IP);
    expect(result.allowed).toBe(true);
  });

  it("iný user z tej istej IP nie je zablokovaný neúspechmi prvého usera (pod prahom pre IP)", async () => {
    const spammerId = (
      await adminDb
        .insert(users)
        .values({ orgId: org.id, email: `otp-rl-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Spammer" })
        .returning()
    )[0].id;
    for (let i = 0; i < 5; i++) {
      await recordOtpAttempt({ userId: spammerId, success: false, ip: TEST_IP });
    }

    const bystanderId = (
      await adminDb
        .insert(users)
        .values({ orgId: org.id, email: `otp-rl-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Bystander" })
        .returning()
    )[0].id;
    const result = await checkOtpRateLimit(bystanderId, TEST_IP);
    expect(result.allowed).toBe(true);
  });

  it("zablokuje po 20 neúspešných pokusoch z tej istej IP (aj keď sú od RôZNYCH userov)", async () => {
    const ip = "203.0.113.88"; // vlastná, iná IP než ostatné testy v súbore — nesmie sa im pliesť do počítania
    const distinctUsers = await Promise.all(
      Array.from({ length: 21 }, async () => {
        const [u] = await adminDb
          .insert(users)
          .values({ orgId: org.id, email: `otp-rl-ip-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "IP Test" })
          .returning();
        return u.id;
      }),
    );

    for (const uid of distinctUsers.slice(0, 20)) {
      await recordOtpAttempt({ userId: uid, success: false, ip });
    }

    const result = await checkOtpRateLimit(distinctUsers[20], ip);
    expect(result.allowed).toBe(false);
  });
});

describe("recordOtpAttempt", () => {
  it("zapíše riadok s userId/success/ip presne tak, ako bol zadaný", async () => {
    const freshUserId = (
      await adminDb
        .insert(users)
        .values({ orgId: org.id, email: `otp-rl-test-${crypto.randomUUID()}@test.local`, role: "owner", fullName: "Record Test" })
        .returning()
    )[0].id;

    await recordOtpAttempt({ userId: freshUserId, success: true, ip: "198.51.100.1" });
    const rows = await adminDb.select().from(emailOtpAttempts).where(eq(emailOtpAttempts.userId, freshUserId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ success: true, ip: "198.51.100.1" });
  });
});

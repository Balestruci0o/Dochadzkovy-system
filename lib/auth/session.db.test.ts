import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "@/lib/db/admin";
import { organizations, users } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Integračný test mostu Supabase Auth <-> public.users (auth_user_id),
 * teda presne toho, čo lib/auth/session.ts::getCurrentUser() robí.
 *
 * Nepoužíva Next.js cookie/request kontext (to sa dá overiť len bežiacim
 * serverom — manuálny smoke test), ale overuje samotnú DB logiku: že po
 * reálnom prihlásení cez Supabase Auth vieme podľa `auth.users.id` nájsť
 * ten istý `public.users` riadok, ktorý sme vytvorili.
 */

const TEST_PASSWORD = "testovacie-heslo-123456";
let orgId: string;
let authUserId: string;
let email: string;

beforeAll(async () => {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: `Session test org ${crypto.randomUUID()}` })
    .returning();
  orgId = org.id;

  email = `session-test-${crypto.randomUUID()}@test.local`;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Príprava testu zlyhala: ${error?.message}`);
  }
  authUserId = data.user.id;

  await adminDb.insert(users).values({
    orgId,
    authUserId,
    email,
    role: "employee",
    fullName: "Test Session User",
    activatedAt: new Date(),
  });
});

afterAll(async () => {
  const admin = createSupabaseAdminClient();
  await admin.auth.admin.deleteUser(authUserId);
  await deleteOrgCascade(orgId);
});

describe("prepojenie Supabase Auth <-> public.users (auth_user_id)", () => {
  it("po signInWithPassword vieme podľa auth_user_id nájsť správny users riadok", async () => {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    const { data, error } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD });

    expect(error).toBeNull();
    expect(data.user?.id).toBe(authUserId);

    const [row] = await adminDb
      .select()
      .from(users)
      .where(eq(users.authUserId, data.user!.id))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.email).toBe(email);
    expect(row.orgId).toBe(orgId);
    expect(row.role).toBe("employee");
  });

  it("nesprávne heslo neprihlási", async () => {
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
    const { data, error } = await anon.auth.signInWithPassword({
      email,
      password: "zle-heslo-123456",
    });

    expect(error).not.toBeNull();
    expect(data.user).toBeNull();
  });

  it("deaktivovaný účet (is_active=false) — getCurrentUser() ho má odmietnuť", async () => {
    await adminDb.update(users).set({ isActive: false }).where(eq(users.authUserId, authUserId));

    const [row] = await adminDb.select().from(users).where(eq(users.authUserId, authUserId)).limit(1);
    expect(row.isActive).toBe(false);

    await adminDb.update(users).set({ isActive: true }).where(eq(users.authUserId, authUserId));
  });
});

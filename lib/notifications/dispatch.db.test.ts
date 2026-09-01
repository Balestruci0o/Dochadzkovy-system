import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { notificationPreferences, notifications, organizations, users } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { notify } from "./dispatch";

/**
 * Blok 11, krok 2 (email kanál) — lokálny mock PRECHÁDZA globálny
 * (`vitest.setup.ts`), aby tieto testy mohli overiť, ŽE sa poslalo (a s
 * akým obsahom), nielen že to nespadlo.
 */
const sendMock = vi.fn<(params: { to: string; subject: string; html: string }) => Promise<{ data: { id: string } | null; error: null }>>();
sendMock.mockResolvedValue({ data: { id: "test-mock" }, error: null });
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

/**
 * `notify()` je JEDINÁ cesta do `notifications`, pre
 * HOCIKOHO iného, než je práve prihlásený používateľ (presne to je dôvod,
 * prečo notifikácie existujú — manažér koná, zamestnanec sa dozvie). Bez
 * `create_notification()` (SECURITY DEFINER, migrácia 0019) by `notifications_own`
 * RLS (len user_id = current_user_id()) toto zablokovala — rovnaký bug ako
 * `materialize_absence_request()` bez SECURITY DEFINER.
 */

let orgId: string;
let actingUserId: string;
let recipientUserId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `dispatch test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;
  const [acting] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `acting-${crypto.randomUUID()}@dispatch-test.local`, role: "manager", fullName: "Konajúci" })
    .returning();
  actingUserId = acting.id;
  const [recipient] = await adminDb
    .insert(users)
    .values({ orgId, authUserId: crypto.randomUUID(), email: `recipient-${crypto.randomUUID()}@dispatch-test.local`, role: "employee", fullName: "Príjemca" })
    .returning();
  recipientUserId = recipient.id;
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

describe("notify() — cez create_notification() (SECURITY DEFINER), pre INÉHO používateľa než konajúci", () => {
  it("konajúci (manager) vytvorí notifikáciu PRE INÉHO používateľa — zapíše sa presne s jeho user_id", async () => {
    await withUserContext(actingUserId, (tx) =>
      notify(tx, { userId: recipientUserId, kind: "absence_request_submitted", title: "Nová žiadosť o dovolenku", body: "Test Zamestnanec, 2027-01-01", link: "/ziadosti" }),
    );

    const rows = await adminDb.select().from(notifications).where(and(eq(notifications.userId, recipientUserId), eq(notifications.kind, "absence_request_submitted")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Nová žiadosť o dovolenku", body: "Test Zamestnanec, 2027-01-01", link: "/ziadosti", readAt: null });
  });

  it("payload sa uloží ako jsonb, čitateľné späť", async () => {
    await withUserContext(actingUserId, (tx) =>
      notify(tx, { userId: recipientUserId, kind: "schedule_gap_detected", title: "Diera", payload: { gapCount: 3, workplaceId: "abc" } }),
    );

    const [row] = await adminDb.select().from(notifications).where(and(eq(notifications.userId, recipientUserId), eq(notifications.kind, "schedule_gap_detected")));
    expect(row.payload).toEqual({ gapCount: 3, workplaceId: "abc" });
  });

  it("príjemca VIDÍ svoju notifikáciu pod vlastnou RLS identitou (notifications_own)", async () => {
    const seen = await withUserContext(recipientUserId, (tx) => tx.select().from(notifications).where(eq(notifications.kind, "absence_request_submitted")));
    expect(seen.length).toBeGreaterThan(0);
  });

  it("konajúci (manager) NEVIDÍ notifikáciu, ktorú vytvoril pre iného (notifications_own — len vlastný user_id)", async () => {
    const seenByActing = await withUserContext(actingUserId, (tx) => tx.select().from(notifications).where(eq(notifications.userId, recipientUserId)));
    expect(seenByActing).toHaveLength(0);
  });
});

describe("notify() — email kanál (Blok 11, krok 2)", () => {
  it("bez preferenčného riadku (default) → email SA POŠLE, na príjemcov email z create_notification(), a emailSentAt sa zapíše", async () => {
    sendMock.mockClear();

    await withUserContext(actingUserId, (tx) =>
      notify(tx, { userId: recipientUserId, kind: "punch_correction_requested", title: "Žiadosť o opravu razítka", body: "Test, 2027-02-01", link: "/dnes" }),
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    const [recipient] = await adminDb.select().from(users).where(eq(users.id, recipientUserId));
    expect(call.to).toBe(recipient.email);
    expect(call.subject).toBe("Žiadosť o opravu razítka");

    const [row] = await adminDb.select().from(notifications).where(and(eq(notifications.userId, recipientUserId), eq(notifications.kind, "punch_correction_requested")));
    expect(row.emailSentAt).not.toBeNull();
  });

  it("s vypnutou preferenciou (notification_preferences.enabled=false pre email) → email sa NEPOŠLE, in-app riadok VZNIKNE aj tak", async () => {
    await adminDb.insert(notificationPreferences).values({ userId: recipientUserId, kind: "schedule_gap_detected", channel: "email", enabled: false });
    sendMock.mockClear();

    await withUserContext(actingUserId, (tx) => notify(tx, { userId: recipientUserId, kind: "schedule_gap_detected", title: "3 diery v rozvrhu" }));

    expect(sendMock).not.toHaveBeenCalled();
    const [row] = await adminDb.select().from(notifications).where(and(eq(notifications.userId, recipientUserId), eq(notifications.kind, "schedule_gap_detected"), eq(notifications.title, "3 diery v rozvrhu")));
    expect(row).toBeDefined(); // in-app kanál je nezávislý od email preferencie — vždy zapnuté
    expect(row.emailSentAt).toBeNull();
  });

  it("absence_request_approved s payloadom → renderuje sa cez absenceDecisionEmailHtml (obsahuje dôvod aj bez neho vynechaný správne)", async () => {
    sendMock.mockClear();

    await withUserContext(actingUserId, (tx) =>
      notify(tx, {
        userId: recipientUserId,
        kind: "absence_request_approved",
        title: "Žiadosť o dovolenku schválená",
        body: "2027-03-01 – 2027-03-02",
        link: "/moje-ziadosti",
        payload: { approved: true, kindLabel: "Dovolenka", period: "2027-03-01 – 2027-03-02", decisionNote: null },
      }),
    );

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.html).toContain("schválená");
    expect(call.html).toContain("2027-03-01 – 2027-03-02");
  });
});

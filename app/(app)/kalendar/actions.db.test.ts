import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees/terminál priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import {
  attendanceDays,
  employees,
  organizations,
  qrTokens,
  scheduledShifts,
  shiftTemplates,
  terminals,
  users,
  workplaces,
} from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { canonicalPunchMessage, computeHmac, encryptTerminalSecret } from "@/lib/punch/hmac";
import { issueQrToken } from "@/lib/punch/qr-token";
import { zonedTimeToUtc } from "@/lib/shared/time";
import { POST as punchPost } from "@/app/api/punch/route";
import { assignShiftAction } from "./actions";

/**
 * Skupina C — celý životný cyklus (scenár C1): manažér zamkne zmenu do
 * `scheduled_shifts` (`assignShiftAction`) → zamestnanec pípne príchod aj
 * odchod cez reálny terminál (`POST /api/punch`) → odpracované hodiny sa
 * prepočítajú z REÁLNEHO plánu vrátane prestávky (`attendance_days`).
 *
 * `generateSchedule()` (Blok 9) nemá dosiaľ DB-loading/zápisovú vrstvu
 * — takto zamknutá zmena je najbližšie k "reálnemu rozvrhu",
 * čo dnes existuje ako skutočná cesta zápisu do `scheduled_shifts`.
 *
 * Auth pre `assignShiftAction` (server action, `requireRole`) sa mockuje
 * rovnako ako v `punch-web.test.ts` — `next/headers` vráti overené
 * `x-supabase-user-id`, presne ako to za normálnych okolností robí
 * middleware.ts.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

// revalidatePath vyžaduje bežiaci Next.js request context (static generation
// store), ktorý mimo skutočného servera neexistuje — akcia ho volá len ako
// vedľajší efekt po zápise, netýka sa toho, čo tento test overuje.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const TERMINAL_SECRET = "esp32-lifecycle-secret-abcdef123456";

let orgId: string;
let workplaceId: string;
let ownerAuthUserId: string;
let shiftTemplateId: string;
let deviceId: string;

function req(body: unknown): Request {
  return new Request("http://localhost/api/punch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sign(devId: string, secret: string, token: string, timestamp: string) {
  return computeHmac(secret, canonicalPunchMessage(devId, token, timestamp));
}

async function punchAt(employeeId: string, instant: Date) {
  const { token, jti } = await issueQrToken(employeeId);
  await adminDb.insert(qrTokens).values({ jti, employeeId, expiresAt: new Date(Date.now() + 30_000) });
  const timestamp = instant.toISOString();
  const hmac = sign(deviceId, TERMINAL_SECRET, token, timestamp);
  return punchPost(req({ token, deviceId, timestamp, hmac }));
}

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `Lifecycle C1 test org ${crypto.randomUUID()}` }).returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  ownerAuthUserId = crypto.randomUUID();
  await adminDb.insert(users).values({
    orgId,
    authUserId: ownerAuthUserId,
    email: `owner-${crypto.randomUUID()}@lifecycle-test.local`,
    role: "owner",
    fullName: "Test Majiteľ",
  });

  const [template] = await adminDb
    .insert(shiftTemplates)
    .values({
      workplaceId,
      name: "Denná 8h",
      code: `D8-${crypto.randomUUID().slice(0, 8)}`,
      startTime: "07:00:00",
      endTime: "15:00:00",
      crossesMidnight: false,
      breakMinutes: 30,
    })
    .returning();
  shiftTemplateId = template.id;

  deviceId = `esp32-lifecycle-${crypto.randomUUID()}`;
  await adminDb.insert(terminals).values({ workplaceId, name: "Vrátnica", deviceId, secretHash: encryptTerminalSecret(TERMINAL_SECRET), isActive: true });
});

afterAll(async () => {
  // attendance_days NIE JE append-only (na rozdiel od punch_events) — upratanie
  // prípadných nedokončených 'working' riadkov zabraňuje hromadeniu, ktoré
  // spomaľovalo runAutoClose(). Musí ísť PRED
  // deleteOrgCascade, lebo ten pri punch_events príde k append-only triggeru
  // a org (aj s attendance_days pod ňou) NECHÁ.
  await adminDb.delete(attendanceDays).where(and(eq(attendanceDays.workplaceId, workplaceId), eq(attendanceDays.status, "working")));
  await deleteOrgCascade(orgId);
});

describe("Skupina C — scenár C1: naplánovaná (zamknutá) zmena → reálne pípnutie in/out → hodiny sedia s plánom", () => {
  it("manažér zamkne zmenu 07:00–15:00 (30 min prestávka) → zamestnanec pípne presne podľa plánu → workedHours = 7.5h (8h – prestávka), nie 8h", async () => {
    const [employee] = await adminDb
      .insert(employees)
      .values({ orgId, firstName: "Životný", lastName: "Cyklus", hiredOn: "2024-01-01" })
      .returning();
    const employeeId = employee.id;

    // 1. Manažér (owner) zamkne zmenu — REÁLNA cesta zápisu do scheduled_shifts.
    authState.authUserId = ownerAuthUserId;
    const form = new FormData();
    form.set("employeeId", employeeId);
    form.set("workplaceId", workplaceId);
    form.set("date", "2026-01-15");
    form.set("shiftTemplateId", shiftTemplateId);
    await assignShiftAction({}, form);
    authState.authUserId = null;

    const [shift] = await adminDb
      .select()
      .from(scheduledShifts)
      .where(and(eq(scheduledShifts.employeeId, employeeId), eq(scheduledShifts.date, "2026-01-15")));
    expect(shift).toMatchObject({ locked: true, source: "manual", startTime: "07:00:00", endTime: "15:00:00", breakMinutes: 30 });

    // 2. Zamestnanec pípne presne podľa plánu (terminál, HMAC — rovnaká cesta ako produkcia).
    const plannedStart = zonedTimeToUtc("2026-01-15", "07:00:00");
    const plannedEnd = zonedTimeToUtc("2026-01-15", "15:00:00");

    const resIn = await punchAt(employeeId, plannedStart);
    expect(resIn.status).toBe(200);
    expect((await resIn.json()).direction).toBe("in");

    const resOut = await punchAt(employeeId, plannedEnd);
    expect(resOut.status).toBe(200);
    expect((await resOut.json()).direction).toBe("out");

    // 3. Odpracované hodiny MUSIA odrážať PLÁN (8h rozpätie – 30 min prestávka = 7.5h), nie surový punch-to-punch rozdiel.
    const [day] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, "2026-01-15")));
    expect(day.status).toBe("done");
    expect(Number(day.workedHours)).toBeCloseTo(7.5, 6);
  }, 45_000); // assignShiftAction + 2× plný POST /api/punch — viac round-tripov než typický test, nad globálnych 30s
});

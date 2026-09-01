import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/users/employees priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, employeeWorkplaces, organizations, punchEvents, users, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { POST } from "./route";

/**
 * Pípanie priamo z webu (home office). GPS je LEN soft
 * signál: "Nikdy neblokuje pípnutie — len označí gps_suspicious".
 * Trasa volá getCurrentUser() (next/headers) — mockneme rýchlu cestu, ktorou
 * middleware.ts bežne odovzdáva overené auth_user_id (x-supabase-user-id),
 * aby sme testovali skutočný route handler, nie len jeho závislosti.
 *
 * Rovnako ako v punch.test.ts: `afterAll` nemaže org (punch_events je
 * append-only — DELETE odmietne aj cez CASCADE). Každý
 * test, ktorý úspešne zapíše razítko, dostane VLASTNÉHO zamestnanca, aby
 * jeho riadok v punch_events nezasahoval do iného testu.
 *
 * `attendance_days` ALE append-only nie je (odvodená tabuľka) — testy, ktoré
 * zapíšu len "in" bez "out" (viac nižšie), by inak navždy nechali
 * `status: 'working'` riadky, ktoré potom spomaľujú `runAutoClose()`.
 * `afterAll` ich preto upratuje.
 *
 * KRITICKÉ — "rovnaké pravidlá ako terminál": web-pípanie MUSÍ
 * prejsť rovnakým overením ako QR terminál — `employees.can_punch_web`
 * (default false, bez neho 403 bez ohľadu na členstvo v prevádzke),
 * rate limiting (`checkPunchRateLimit`, rovnaký 20/60s limit ako terminál),
 * a `kind` ("zmena"/"prestavka") smerom do `determineDirection` presne ako
 * `processPunch`. Testy nižšie overujú všetky tri, nie len GPS.
 */

const authState = vi.hoisted(() => ({ authUserId: null as string | null }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(authState.authUserId ? { "x-supabase-user-id": authState.authUserId } : {}),
}));

const WORKPLACE_LAT = 48.1486;
const WORKPLACE_LNG = 17.1077;

let orgId: string;
let workplaceId: string;
let otherWorkplaceId: string;

function webReq(body: unknown): Request {
  return new Request("http://localhost/api/punch/web", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Vlastný, jednorazovo prihlásený zamestnanec s členstvom v `workplaceId`.
 * `canPunchWeb` default `true` — väčšina testov v tomto súbore overuje
 * SPRÁVANIE PO povolení; permission-gate testy nižšie si ho vypnú explicitne. */
async function freshLinkedEmployee(name: string, opts?: { canPunchWeb?: boolean }) {
  const [user] = await adminDb
    .insert(users)
    .values({
      orgId,
      authUserId: crypto.randomUUID(),
      email: `${crypto.randomUUID()}@punch-web-test.local`,
      role: "employee",
      fullName: name,
    })
    .returning();

  const [employee] = await adminDb
    .insert(employees)
    .values({
      orgId,
      userId: user.id,
      firstName: name,
      lastName: "Webová",
      hiredOn: "2024-01-01",
      canPunchWeb: opts?.canPunchWeb ?? true,
    })
    .returning();
  await adminDb.insert(employeeWorkplaces).values({ employeeId: employee.id, workplaceId });

  return { authUserId: user.authUserId as string, employeeId: employee.id };
}

beforeAll(async () => {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: `Punch web test org ${crypto.randomUUID()}` })
    .returning();
  orgId = org.id;

  const [wp, otherWp] = await adminDb
    .insert(workplaces)
    .values([
      { orgId, name: "Office", code: "OFFICE", gpsLat: String(WORKPLACE_LAT), gpsLng: String(WORKPLACE_LNG), gpsRadiusM: 150 },
      { orgId, name: "Hotel", code: "HOTEL" },
    ])
    .returning();
  workplaceId = wp.id;
  otherWorkplaceId = otherWp.id;
});

afterAll(async () => {
  // Upratanie 'working' attendance_days OK je (nie append-only) — viď komentár na začiatku súboru.
  // MUSÍ ísť pred deleteOrgCascade: tá pri punch_events (append-only) org NECHÁ,
  // takže attendance_days pod ňou by inak zostal nedotknutý.
  await adminDb
    .delete(attendanceDays)
    .where(and(inArray(attendanceDays.workplaceId, [workplaceId, otherWorkplaceId]), eq(attendanceDays.status, "working")));
  await deleteOrgCascade(orgId);
});

afterEach(() => {
  authState.authUserId = null;
});

describe("POST /api/punch/web — autentifikácia a členstvo", () => {
  it("neprihlásený (žiadna zhoda auth_user_id) je zamietnutý (401)", async () => {
    authState.authUserId = crypto.randomUUID(); // nikto s týmto auth_user_id neexistuje v users
    const res = await POST(webReq({ workplaceId }));
    expect(res.status).toBe(401);
  });

  it("zamestnanec bez priradenia k danej prevádzke je zamietnutý (403)", async () => {
    const { authUserId } = await freshLinkedEmployee("Bez prevádzky");
    authState.authUserId = authUserId;
    const res = await POST(webReq({ workplaceId: otherWorkplaceId }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/punch/web — povolenie can_punch_web (DEFAULT VYPNUTÉ)", () => {
  it("zamestnanec BEZ povolenia je zamietnutý (403), aj keď je členom prevádzky", async () => {
    const { authUserId, employeeId } = await freshLinkedEmployee("Bez povolenia", { canPunchWeb: false });
    authState.authUserId = authUserId;
    const res = await POST(webReq({ workplaceId }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/nemáš povolené/i);

    const rows = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employeeId));
    expect(rows).toHaveLength(0);
  });

  it("zamestnanec S povolením prejde (200)", async () => {
    const { authUserId } = await freshLinkedEmployee("S povolením", { canPunchWeb: true });
    authState.authUserId = authUserId;
    const res = await POST(webReq({ workplaceId }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/punch/web — rate limiting podľa employee_id (rovnaký limit ako QR terminál, lib/punch/rate-limit.ts)", () => {
  it("jeden zamestnanec nad limitom (20/60s) dostane 429", async () => {
    const { authUserId, employeeId } = await freshLinkedEmployee("RateLimit web-spammer");
    authState.authUserId = authUserId;

    // 19 "predchádzajúcich" razítok priamo (rovnaký vzor ako punch.test.ts) — receivedAt = teraz, bezpečne v 60s okne.
    await adminDb.insert(punchEvents).values(
      Array.from({ length: 19 }, (_, i) => ({
        employeeId,
        workplaceId,
        direction: (i % 2 === 0 ? "in" : "out") as "in" | "out",
        method: "web" as const,
        occurredAt: new Date(),
        receivedAt: new Date(),
      })),
    );

    // 20. (skutočný POST) ešte prejde — presne na hranici limitu.
    const res = await POST(webReq({ workplaceId }));
    expect(res.status).toBe(200);

    // 21. je nad limitom — zamietnuté, aj keď je inak úplne legitímne.
    const overRes = await POST(webReq({ workplaceId }));
    expect(overRes.status).toBe(429);
  });
});

describe("POST /api/punch/web — kind (zmena/prestavka, pípanie prestávok krok 3)", () => {
  it("kind='prestavka' zapíše samostatnú in/out sekvenciu, nezávislú od 'zmena'", async () => {
    const { authUserId, employeeId } = await freshLinkedEmployee("Web prestávky");
    authState.authUserId = authUserId;

    const zmenaRes = await POST(webReq({ workplaceId, kind: "zmena" }));
    expect(zmenaRes.status).toBe(200);
    const zmenaBody = await zmenaRes.json();
    expect(zmenaBody.direction).toBe("in");
    expect(zmenaBody.kind).toBe("zmena");

    // Prvé razítko kind='prestavka' je vždy 'out' (odchod NA prestávku) —
    // opačný default ako 'zmena', viď lib/punch/attendance.ts.
    const prestavkaRes = await POST(webReq({ workplaceId, kind: "prestavka" }));
    expect(prestavkaRes.status).toBe(200);
    const prestavkaBody = await prestavkaRes.json();
    expect(prestavkaBody.direction).toBe("out");
    expect(prestavkaBody.kind).toBe("prestavka");

    const rows = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employeeId));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.kind === "zmena")?.direction).toBe("in");
    expect(rows.find((r) => r.kind === "prestavka")?.direction).toBe("out");
  });
});

describe("POST /api/punch/web — bod 7d: GPS je len soft signál, nikdy neblokuje", () => {
  it("GPS presne na súradniciach prevádzky → gps_suspicious = false, razítko prejde", async () => {
    const { authUserId, employeeId } = await freshLinkedEmployee("Presne tu");
    authState.authUserId = authUserId;
    const res = await POST(webReq({ workplaceId, gpsLat: WORKPLACE_LAT, gpsLng: WORKPLACE_LNG, gpsAccuracyM: 10 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gpsSuspicious).toBe(false);
    expect(body.direction).toBe("in");

    const [event] = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employeeId));
    expect(event.gpsSuspicious).toBe(false);
    expect(Number(event.gpsDistanceM)).toBeLessThan(50);
    expect(event.method).toBe("web");
  });

  it("GPS ~1,1 km mimo okruhu → razítko AJ TAK PREJDE (200), len sa označí gps_suspicious = true", async () => {
    const { authUserId, employeeId } = await freshLinkedEmployee("Mimo okruhu");
    authState.authUserId = authUserId;
    const farLat = WORKPLACE_LAT + 0.01; // ~1.1 km
    const res = await POST(webReq({ workplaceId, gpsLat: farLat, gpsLng: WORKPLACE_LNG, gpsAccuracyM: 10 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gpsSuspicious).toBe(true);
    expect(body.direction).toBe("in");

    const [event] = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employeeId));
    expect(event.gpsSuspicious).toBe(true);
    expect(Number(event.gpsDistanceM)).toBeGreaterThan(150);
  });

  it("bez GPS vôbec (zamestnanec zamietol polohu v prehliadači) → razítko AJ TAK PREJDE", async () => {
    const { authUserId, employeeId } = await freshLinkedEmployee("Bez GPS");
    authState.authUserId = authUserId;
    const res = await POST(webReq({ workplaceId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gpsSuspicious).toBe(false);
    expect(body.direction).toBe("in");

    const [event] = await adminDb.select().from(punchEvents).where(eq(punchEvents.employeeId, employeeId));
    expect(event.gpsDistanceM).toBeNull();
    expect(event.gpsSuspicious).toBe(false);
  });
});

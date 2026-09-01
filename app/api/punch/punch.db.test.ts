import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra simuluje terminál/service-role cesty (rovnaká výnimka ako route.ts), potrebuje priamy prístup bez app.user_id
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, organizations, punchEvents, qrTokens, terminals, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { canonicalPunchMessage, computeHmac, encryptTerminalSecret } from "@/lib/punch/hmac";
import { issueQrToken } from "@/lib/punch/qr-token";
import { POST as punchPost } from "./route";
import { POST as syncPost } from "./sync/route";

/**
 * Blok 7c/7e (🔍) — terminál simulovaný presne tak, ako by poslal reálny
 * ESP32: JSON telo + HMAC-SHA256 podpis kanonickej správy vlastným
 * tajomstvom. Každý bod z poradia overení v route.ts má tu svoj test,
 * ktorý sa ho snaží obísť. Trasa POST/route.ts sa importuje priamo (Web
 * Request/Response API), nepotrebuje bežiaci server.
 *
 * `afterAll` NEMAŽE org/employees/punch_events: každý test, ktorému sa
 * podarí zapísať razítko, tým natrvalo znemožní zmazať jeho org
 * (trg_punch_no_delete odmietne DELETE aj cez CASCADE z
 * organizations → employees → punch_events, aj pod adminDb). To nie je chyba
 * testu, je to dôkaz, že append-only guarantee naozaj drží aj proti service
 * role. Testy preto radšej dostanú vlastného, jednorazového zamestnanca tam,
 * kde by zdieľaný stav (razítka toho istého dňa) skreslil ďalší test.
 *
 * `attendance_days` (na rozdiel od `punch_events`) NIE JE append-only — je
 * to odvodená/prepočítavaná tabuľka, bezpečná na zmazanie. Testy anti-replay/
 * rate-limitu úmyselne zapíšu presne JEDEN úspešný "in" bez "out" (to je to,
 * čo overujú), čím zanechajú `status: 'working'` navždy. `runAutoClose()`
 * (Skupina C, `lib/punch/auto-close.test.ts`) také riadky sweepne VŠETKY
 * naprieč celou DB bez filtra na organizáciu — nahromadené testovacie
 * riadky (183 ich bolo pred touto opravou) preto robili ten
 * test nepoužiteľne pomalým. `afterAll` preto tieto riadky upratuje, nech sa
 * nehromadia znova.
 */

const ACTIVE_SECRET = "esp32-active-secret-abcdef123456";
const INACTIVE_SECRET = "esp32-inactive-secret-zzzzzz9999";

let orgId: string;
let workplaceId: string;
let employeeId: string;
let activeTerminalId: string;
let activeDeviceId: string;
let inactiveDeviceId: string;

function req(body: unknown): Request {
  return new Request("http://localhost/api/punch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function syncReq(body: unknown): Request {
  return new Request("http://localhost/api/punch/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Presne to, čo by ESP32 zostavil: podpíše {deviceId, token, timestamp} vlastným tajomstvom. */
function sign(deviceId: string, secret: string, token: string, timestamp: string) {
  return computeHmac(secret, canonicalPunchMessage(deviceId, token, timestamp));
}

/** Vydá platný token presne tak, ako GET /api/qr-token (JWT + riadok v qr_tokens). */
async function mintValidToken(empId: string = employeeId, kind: "zmena" | "prestavka" = "zmena") {
  const { token, jti, expiresAt } = await issueQrToken(empId, kind);
  await adminDb.insert(qrTokens).values({ jti, employeeId: empId, expiresAt });
  return { token, jti };
}

/** Token so signatúrou, ktorý je od vydania už vypršaný — pre test bodu 4 a offline sync (7e). */
async function mintExpiredToken(empId: string = employeeId) {
  const key = Buffer.from(process.env.QR_TOKEN_SECRET!, "base64");
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ employeeId: empId })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt(Math.floor(Date.now() / 1000) - 120)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(key);
  await adminDb.insert(qrTokens).values({ jti, employeeId: empId, expiresAt: new Date(Date.now() - 60_000) });
  return { token, jti };
}

/**
 * Vlastný, jednorazový zamestnanec pre testy, ktoré ÚSPEŠNE zapíšu razítko —
 * nezdieľajú deň so žiadnym iným testom, takže poradie in/out sa nedá
 * skresliť razítkami z inej `it()` (punch_events sa nedá medzi testami
 * vyčistiť, viď komentár na začiatku súboru).
 */
async function freshEmployee(name: string) {
  const [row] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: name, lastName: "Testovací", hiredOn: "2024-01-01" })
    .returning();
  return row.id;
}

beforeAll(async () => {
  const [org] = await adminDb
    .insert(organizations)
    .values({ name: `Punch security test org ${crypto.randomUUID()}` })
    .returning();
  orgId = org.id;

  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;

  const [employee] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Ján", lastName: "Terminálový", hiredOn: "2024-01-01" })
    .returning();
  employeeId = employee.id;

  activeDeviceId = `esp32-active-${crypto.randomUUID()}`;
  inactiveDeviceId = `esp32-inactive-${crypto.randomUUID()}`;

  const [activeTerminal] = await adminDb
    .insert(terminals)
    .values({
      workplaceId,
      name: "Vrátnica",
      deviceId: activeDeviceId,
      secretHash: encryptTerminalSecret(ACTIVE_SECRET),
      isActive: true,
    })
    .returning();
  activeTerminalId = activeTerminal.id;

  await adminDb.insert(terminals).values({
    workplaceId,
    name: "Vyradený terminál",
    deviceId: inactiveDeviceId,
    secretHash: encryptTerminalSecret(INACTIVE_SECRET),
    isActive: false,
  });
});

afterAll(async () => {
  // Upratanie 'working' attendance_days OK je (nie append-only) — viď komentár na začiatku súboru.
  // MUSÍ ísť pred deleteOrgCascade (tá pri punch_events org bezpečne NECHÁ).
  await adminDb.delete(attendanceDays).where(and(eq(attendanceDays.workplaceId, workplaceId), eq(attendanceDays.status, "working")));
  await deleteOrgCascade(orgId);
});

describe("POST /api/punch — bod 1: HMAC podpis terminálu", () => {
  it("zlý HMAC (podpísané cudzím tajomstvom) je zamietnutý", async () => {
    const { token } = await mintValidToken();
    const timestamp = new Date().toISOString();
    const badHmac = sign(activeDeviceId, "totally-wrong-secret", token, timestamp);

    const res = await punchPost(req({ token, deviceId: activeDeviceId, timestamp, hmac: badHmac }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Terminál nie je overený.");
  });

  it("neznáme device_id je zamietnuté s ÚPLNE ROVNAKOU hláškou ako zlý HMAC (žiadna enumerácia zariadení)", async () => {
    const { token } = await mintValidToken();
    const timestamp = new Date().toISOString();
    const hmac = sign("nikdy-neregistrovany-device", ACTIVE_SECRET, token, timestamp);

    const res = await punchPost(req({ token, deviceId: "nikdy-neregistrovany-device", timestamp, hmac }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Terminál nie je overený.");
  });

  it("požiadavka bez podpisu vôbec (holý curl, chýbajúce pole hmac) je zamietnutá", async () => {
    const { token } = await mintValidToken();
    const res = await punchPost(
      new Request("http://localhost/api/punch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, deviceId: activeDeviceId, timestamp: new Date().toISOString() }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("hmac pole s nehexadecimálnym obsahom nezhodí server, len ho zamietne", async () => {
    const { token } = await mintValidToken();
    const timestamp = new Date().toISOString();
    const res = await punchPost(req({ token, deviceId: activeDeviceId, timestamp, hmac: "nie je to hex vôbec!!" }));
    expect(res.status).toBe(401);
  });

  it("pozmenená správa (iný token, ale ten istý podpis) je zamietnutá", async () => {
    const { token: signedToken } = await mintValidToken();
    const { token: swappedToken } = await mintValidToken();
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, signedToken, timestamp);

    const res = await punchPost(req({ token: swappedToken, deviceId: activeDeviceId, timestamp, hmac }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Terminál nie je overený.");
  });
});

describe("POST /api/punch — bod 2: terminál musí byť aktívny", () => {
  it("vyradený terminál je zamietnutý (403), aj keď je HMAC aj JWT úplne v poriadku", async () => {
    const { token } = await mintValidToken();
    const timestamp = new Date().toISOString();
    const hmac = sign(inactiveDeviceId, INACTIVE_SECRET, token, timestamp);

    const res = await punchPost(req({ token, deviceId: inactiveDeviceId, timestamp, hmac }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Terminál nie je overený.");
  });
});

describe("POST /api/punch — bod 3: JWT podpis musí byť platný", () => {
  it("skomolený token (nie je to JWT) je zamietnutý", async () => {
    const timestamp = new Date().toISOString();
    const garbage = "toto-nie-je-jwt";
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, garbage, timestamp);

    const res = await punchPost(req({ token: garbage, deviceId: activeDeviceId, timestamp, hmac }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Neplatný QR kód.");
  });

  it("JWT podpísaný CUDZÍM tajomstvom (falošný server) je zamietnutý", async () => {
    const foreignKey = randomBytes(32);
    const jti = crypto.randomUUID();
    const forged = await new SignJWT({ employeeId })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(foreignKey);
    await adminDb.insert(qrTokens).values({ jti, employeeId, expiresAt: new Date(Date.now() + 30_000) });

    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, forged, timestamp);

    const res = await punchPost(req({ token: forged, deviceId: activeDeviceId, timestamp, hmac }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Neplatný QR kód.");
  });
});

describe("POST /api/punch — bod 4: JWT nesmie byť vypršaný (online cesta netoleruje nič)", () => {
  it("vypršaný, ale platne podpísaný token je zamietnutý", async () => {
    const { token } = await mintExpiredToken();
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, timestamp);

    const res = await punchPost(req({ token, deviceId: activeDeviceId, timestamp, hmac }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("QR kód vypršal, naskenuj nový.");
  });
});

describe("POST /api/punch — bod 5-6: anti-replay (jti sa dá minúť len raz, atomicky)", () => {
  it("ten istý token dvakrát — druhý pokus je zamietnutý (409)", async () => {
    const empId = await freshEmployee("Replay");
    const { token } = await mintValidToken(empId);
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, timestamp);
    const body = { token, deviceId: activeDeviceId, timestamp, hmac };

    const first = await punchPost(req(body));
    expect(first.status).toBe(200);

    const second = await punchPost(req(body));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("QR kód už bol použitý.");
  });

  it("súbežné (race) použitie toho istého tokenu — z dvoch paralelných pokusov uspeje presne JEDEN", async () => {
    const empId = await freshEmployee("Race");
    const { token } = await mintValidToken(empId);
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, timestamp);
    const body = { token, deviceId: activeDeviceId, timestamp, hmac };

    const [a, b] = await Promise.all([punchPost(req(body)), punchPost(req(body))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });
});

describe("POST /api/punch — bod 7-9: smer, zápis punch_events, prepočet attendance_days", () => {
  it("prvé razítko dňa je 'in', druhé je 'out'; oboje sa zapíšu a attendance_days sa prepočíta", async () => {
    const empId = await freshEmployee("Smerový");
    const inToken = await mintValidToken(empId);
    const t1 = new Date();
    t1.setUTCHours(6, 0, 0, 0);
    const hmac1 = sign(activeDeviceId, ACTIVE_SECRET, inToken.token, t1.toISOString());
    const res1 = await punchPost(req({ token: inToken.token, deviceId: activeDeviceId, timestamp: t1.toISOString(), hmac: hmac1 }));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.direction).toBe("in");
    expect(body1.employeeName).toBe("Smerový Testovací");
    expect(typeof body1.time).toBe("string");

    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bratislava" }).format(t1);

    const [dayAfterIn] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, dateStr)));
    expect(dayAfterIn).toMatchObject({ status: "working" });
    expect(dayAfterIn.actualStart).not.toBeNull();

    const outToken = await mintValidToken(empId);
    const t2 = new Date(t1.getTime() + 8 * 3600 * 1000);
    const hmac2 = sign(activeDeviceId, ACTIVE_SECRET, outToken.token, t2.toISOString());
    const res2 = await punchPost(req({ token: outToken.token, deviceId: activeDeviceId, timestamp: t2.toISOString(), hmac: hmac2 }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).direction).toBe("out");

    const [dayAfterOut] = await adminDb
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, empId), eq(attendanceDays.date, dateStr)));
    expect(dayAfterOut.status).toBe("done");
    expect(dayAfterOut.actualEnd).not.toBeNull();
    expect(Number(dayAfterOut.workedHours)).toBeCloseTo(8, 1);

    const events = await adminDb
      .select()
      .from(punchEvents)
      .where(and(eq(punchEvents.employeeId, empId), eq(punchEvents.workplaceId, workplaceId)));
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.method).toBe("qr_terminal");
      expect(e.terminalId).toBe(activeTerminalId);
      expect(e.isOfflineSync).toBe(false);
    }
  });
});

describe("POST /api/punch — pípanie prestávok (krok 3): druhý QR kód, kind prepína smer NEZÁVISLE", () => {
  it("zmena a prestávka majú KAŽDÁ svoju vlastnú in/out sekvenciu v ten istý deň", async () => {
    const empId = await freshEmployee("Prestavkovy");
    const t0 = new Date();
    t0.setUTCHours(6, 0, 0, 0);

    async function punchAt(kind: "zmena" | "prestavka", offsetMinutes: number) {
      const { token } = await mintValidToken(empId, kind);
      const ts = new Date(t0.getTime() + offsetMinutes * 60_000).toISOString();
      const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, ts);
      const res = await punchPost(req({ token, deviceId: activeDeviceId, timestamp: ts, hmac }));
      expect(res.status).toBe(200);
      return res.json();
    }

    const shiftIn = await punchAt("zmena", 0);
    expect(shiftIn).toMatchObject({ direction: "in", kind: "zmena" });

    const breakOut = await punchAt("prestavka", 120);
    expect(breakOut).toMatchObject({ direction: "out", kind: "prestavka" });

    const breakIn = await punchAt("prestavka", 150);
    expect(breakIn).toMatchObject({ direction: "in", kind: "prestavka" });

    // Druhá prestávka v ten istý deň — potvrdzuje "aj viac prestávok za deň" zo zadania.
    const breakOut2 = await punchAt("prestavka", 240);
    expect(breakOut2).toMatchObject({ direction: "out", kind: "prestavka" });
    const breakIn2 = await punchAt("prestavka", 255);
    expect(breakIn2).toMatchObject({ direction: "in", kind: "prestavka" });

    // Zmena je STÁLE "in" (ešte nezavretá) — prestávkové razítka na ňu nemajú vplyv.
    const shiftOut = await punchAt("zmena", 480);
    expect(shiftOut).toMatchObject({ direction: "out", kind: "zmena" });

    const events = await adminDb
      .select()
      .from(punchEvents)
      .where(and(eq(punchEvents.employeeId, empId), eq(punchEvents.workplaceId, workplaceId)));
    expect(events).toHaveLength(6);
    expect(events.filter((e) => e.kind === "zmena")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "prestavka")).toHaveLength(4);
  });
});

describe("POST /api/punch/sync — offline dávka", () => {
  it("toleruje vypršaný JWT (podpis sa aj tak musí overiť)", async () => {
    const empId = await freshEmployee("Sync-expired");
    const { token, jti } = await mintExpiredToken(empId);
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, timestamp);

    const res = await syncPost(syncReq({ deviceId: activeDeviceId, events: [{ token, timestamp, hmac }] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ ok: true, index: 0 });

    const [row] = await adminDb.select().from(qrTokens).where(eq(qrTokens.jti, jti));
    expect(row.usedAt).not.toBeNull();
  });

  it("anti-replay platí aj v dávke — ten istý jti dvakrát v jednej dávke: druhý zlyhá", async () => {
    const empId = await freshEmployee("Sync-replay");
    const { token } = await mintValidToken(empId);
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, timestamp);

    const res = await syncPost(
      syncReq({
        deviceId: activeDeviceId,
        events: [
          { token, timestamp, hmac },
          { token, timestamp, hmac },
        ],
      }),
    );
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: true, index: 0 });
    expect(body.results[1]).toMatchObject({ ok: false, index: 1, reason: "already_used" });
  });

  it("jedna zlá položka v dávke nezhodí zvyšok (čiastočný úspech)", async () => {
    const empId = await freshEmployee("Sync-partial");
    const good = await mintValidToken(empId);
    const timestamp = new Date().toISOString();
    const goodHmac = sign(activeDeviceId, ACTIVE_SECRET, good.token, timestamp);
    const badHmac = sign(activeDeviceId, "cudzie-tajomstvo", "hocijaky-token", timestamp);

    const res = await syncPost(
      syncReq({
        deviceId: activeDeviceId,
        events: [
          { token: "hocijaky-token", timestamp, hmac: badHmac },
          { token: good.token, timestamp, hmac: goodHmac },
        ],
      }),
    );
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, index: 0, reason: "bad_signature" });
    expect(body.results[1]).toMatchObject({ ok: true, index: 1 });
  });

  it("neaktívny terminál zamietne celú dávku (403)", async () => {
    const { token } = await mintValidToken();
    const timestamp = new Date().toISOString();
    const hmac = sign(inactiveDeviceId, INACTIVE_SECRET, token, timestamp);

    const res = await syncPost(syncReq({ deviceId: inactiveDeviceId, events: [{ token, timestamp, hmac }] }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/punch — rate limiting podľa employee_id (end-to-end cez skutočný POST)", () => {
  /**
   * Nájdené pri ladení flaky testov: pôvodná verzia poslala
   * 20 SKUTOČNÝCH sekvenčných requestov cez celý POST /api/punch reťazec
   * (JWT vydanie+insert, verifikácia, transakcia s insertom+prepočtom) a až
   * potom over ila 21. razítko. Pri zhoršenej sieťovej latencii k reálnej
   * (vzdialenej) DB to nebol len pomalý test — `checkPunchRateLimit`
   * (lib/punch/rate-limit.ts) počíta udalosti v POSUVNOM 60s okne
   * (`receivedAt >= now - 60s`), takže keby odoslanie 20 requestov reálne
   * trvalo VIAC než 60 sekúnd, najstaršie z nich by z okna VYPADLI skôr, než
   * by prišiel 21., a test by zlyhal NIE timeoutom, ale nesprávnou hodnotou
   * (429 by nemuselo prísť vôbec) — vyšší `testTimeout` by to vôbec neriešil.
   *
   * Riešenie: prvých 19 udalostí sa vloží PRIAMO (jeden rýchly insert,
   * `receivedAt` = teraz, mimo akéhokoľvek reálneho round-tripu) — hranicu
   * (20. povolené, 21. zamietnuté) aj tak overujú DVA SKUTOČNÉ POST požiadavky
   * cez celý reťazec, presne tie, na ktorých záleží.
   */
  it("jeden zamestnanec nad limitom (20/60s) dostane 429; INÝ zamestnanec na TOM ISTOM termináli nie je dotknutý", async () => {
    const empId = await freshEmployee("RateLimit-spammer");

    // 19 "predchádzajúcich" razítok priamo (rýchlo, mimo reálneho POST reťazca) — receivedAt = teraz, bezpečne v 60s okne.
    await adminDb.insert(punchEvents).values(
      Array.from({ length: 19 }, (_, i) => ({
        employeeId: empId,
        workplaceId,
        direction: (i % 2 === 0 ? "in" : "out") as "in" | "out",
        method: "manual" as const,
        occurredAt: new Date(),
        receivedAt: new Date(),
      })),
    );

    // 20. (skutočný POST) ešte prejde — spolu presne na hranici limitu, nie nad ňou.
    const { token } = await mintValidToken(empId);
    const timestamp = new Date().toISOString();
    const hmac = sign(activeDeviceId, ACTIVE_SECRET, token, timestamp);
    const res = await punchPost(req({ token, deviceId: activeDeviceId, timestamp, hmac }));
    expect(res.status).toBe(200);

    // 21. razítko toho istého človeka je nad limitom — zamietnuté BEZ ohľadu na to, že token/HMAC sú platné.
    const over = await mintValidToken(empId);
    const overTimestamp = new Date().toISOString();
    const overHmac = sign(activeDeviceId, ACTIVE_SECRET, over.token, overTimestamp);
    const overRes = await punchPost(req({ token: over.token, deviceId: activeDeviceId, timestamp: overTimestamp, hmac: overHmac }));
    expect(overRes.status).toBe(429);

    // Limit je PER ZAMESTNANEC, nie per terminál — iný človek pípajúci cez
    // ten istý (jeden) terminál tým nie je vôbec dotknutý.
    const bystanderId = await freshEmployee("RateLimit-bystander");
    const other = await mintValidToken(bystanderId);
    const otherTimestamp = new Date().toISOString();
    const otherHmac = sign(activeDeviceId, ACTIVE_SECRET, other.token, otherTimestamp);
    const otherRes = await punchPost(
      req({ token: other.token, deviceId: activeDeviceId, timestamp: otherTimestamp, hmac: otherHmac }),
    );
    expect(otherRes.status).toBe(200);
  });
});

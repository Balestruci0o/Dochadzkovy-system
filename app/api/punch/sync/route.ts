import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
// eslint-disable-next-line no-restricted-imports -- terminál sa autentifikuje HMAC podpisom, nie Supabase session — žiadny app.user_id neexistuje (docs/ARCHITECTURE.md, service role výnimka pre POST /api/punch)
import { adminDb } from "@/lib/db/admin";
import { terminals } from "@/lib/db/schema";
import { canonicalPunchMessage, decryptTerminalSecret, verifyHmac } from "@/lib/punch/hmac";
import { processPunch } from "@/lib/punch/process-punch";

type SyncEvent = { token: string; timestamp: string; hmac: string };
type SyncBody = { deviceId: string; events: SyncEvent[] };

function parseBody(body: unknown): SyncBody | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.deviceId !== "string" || !b.deviceId || !Array.isArray(b.events)) return null;

  const events: SyncEvent[] = [];
  for (const e of b.events) {
    if (!e || typeof e !== "object") return null;
    const ev = e as Record<string, unknown>;
    if (typeof ev.token !== "string" || typeof ev.timestamp !== "string" || typeof ev.hmac !== "string") {
      return null;
    }
    events.push({ token: ev.token, timestamp: ev.timestamp, hmac: ev.hmac });
  }
  return { deviceId: b.deviceId, events };
}

/**
 * POST /api/punch/sync — dávka razítok z terminálu po výpadku
 * WiFi. Každá položka je presne to isté, čo by terminál poslal na
 * /api/punch v čase skenovania — vlastný `{token, timestamp, hmac}`, ktorý
 * ESP32 uložil do NVS fronty a odošle naraz, keď sa pripojenie obnoví.
 *
 * Rozdiely oproti online ceste:
 *  - `occurred_at` = `timestamp` z terminálu (kedy sa to STALO), nie čas
 *    prijatia servera.
 *  - JWT `exp` je pri sync-e VŽDY vypršaný (bola to dávka spred minút/hodín)
 *    — toleruje sa, ALE podpis sa aj tak musí overiť (processPunch,
 *    allowExpiredJwt: true).
 *  - Anti-replay (`jti`) ostáva jediná skutočná ochrana proti duplicite —
 *    presne rovnaká atomická kontrola ako v online ceste.
 *  - Jedna zlá položka v dávke nezhodí zvyšok — každá sa vyhodnotí zvlášť.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  const [terminal] = await adminDb.select().from(terminals).where(eq(terminals.deviceId, body.deviceId));
  if (!terminal) {
    return NextResponse.json({ error: "Terminál nie je overený." }, { status: 401 });
  }
  if (!terminal.isActive) {
    return NextResponse.json({ error: "Terminál nie je overený." }, { status: 403 });
  }

  let secret: string;
  try {
    secret = decryptTerminalSecret(terminal.secretHash);
  } catch {
    return NextResponse.json({ error: "Terminál nie je overený." }, { status: 401 });
  }

  const results: Array<{
    index: number;
    ok: boolean;
    reason?: string;
    employeeName?: string;
    direction?: string;
    kind?: string;
  }> = [];

  for (let i = 0; i < body.events.length; i++) {
    const event = body.events[i];

    // 1: HMAC podpis PRE KAŽDÚ položku zvlášť — presne tá istá kanonická správa ako online.
    const message = canonicalPunchMessage(body.deviceId, event.token, event.timestamp);
    if (!verifyHmac(secret, message, event.hmac)) {
      results.push({ index: i, ok: false, reason: "bad_signature" });
      continue;
    }

    const occurredAt = new Date(event.timestamp);
    if (Number.isNaN(occurredAt.getTime())) {
      results.push({ index: i, ok: false, reason: "invalid_timestamp" });
      continue;
    }

    const result = await processPunch({
      token: event.token,
      occurredAt,
      terminalId: terminal.id,
      workplaceId: terminal.workplaceId,
      isOfflineSync: true,
      allowExpiredJwt: true,
    });

    if (!result.ok) {
      results.push({ index: i, ok: false, reason: result.reason });
      continue;
    }

    results.push({ index: i, ok: true, employeeName: result.employeeName, direction: result.direction, kind: result.kind });
  }

  await adminDb.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, terminal.id));

  return NextResponse.json({ results });
}

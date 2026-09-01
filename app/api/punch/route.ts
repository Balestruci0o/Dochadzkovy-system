import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
// eslint-disable-next-line no-restricted-imports -- terminál sa autentifikuje HMAC podpisom, nie Supabase session — žiadny app.user_id neexistuje (docs/ARCHITECTURE.md, service role výnimka pre POST /api/punch)
import { adminDb } from "@/lib/db/admin";
import { terminals } from "@/lib/db/schema";
import { canonicalPunchMessage } from "@/lib/punch/hmac";
import { processPunch } from "@/lib/punch/process-punch";
import { verifyQrToken } from "@/lib/punch/qr-token";
import { checkPunchRateLimit } from "@/lib/punch/rate-limit";
import { verifyTerminalRequest } from "@/lib/punch/verify-terminal";
import { getClientIp } from "@/lib/shared/client-ip";

export type PunchBody = {
  token: string;
  deviceId: string;
  timestamp: string;
  hmac: string;
};

function parseBody(body: unknown): PunchBody | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.token !== "string" ||
    typeof b.deviceId !== "string" ||
    typeof b.timestamp !== "string" ||
    typeof b.hmac !== "string" ||
    !b.token ||
    !b.deviceId ||
    !b.timestamp ||
    !b.hmac
  ) {
    return null;
  }
  return { token: b.token, deviceId: b.deviceId, timestamp: b.timestamp, hmac: b.hmac };
}

/**
 * POST /api/punch — sem posiela TERMINÁL, nie mobil. Poradie
 * overení je záväzné a žiadne sa nesmie preskočiť ani presunúť (🔍 blok).
 * Každý bod nižšie má zodpovedajúci test v punch.test.ts, ktorý sa ho snaží
 * obísť. Body 3–9 sú v `processPunch` (zdieľané s /api/punch/sync). Rate
 * limiting beží hneď po bode 1–2, pred zápisom do
 * DB — kombinovane podľa `employee_id` (tesný limit, chráni pred spamom
 * jedného človeka) a podľa IP (veľmi voľný strop, lebo jeden terminál pípa
 * naraz veľa ľudí). Nie podľa `device_id` — to je presne to isté zdieľanie
 * ako pri IP, len o úroveň nižšie.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const body = parseBody(raw);
  if (!body) {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  // 1–2: HMAC podpis terminálu, potom či je terminál aktívny.
  const message = canonicalPunchMessage(body.deviceId, body.token, body.timestamp);
  const terminalResult = await verifyTerminalRequest(body.deviceId, message, body.hmac);
  if (!terminalResult.ok) {
    const status = terminalResult.reason === "inactive_terminal" ? 403 : 401;
    return NextResponse.json({ error: "Terminál nie je overený." }, { status });
  }
  const { terminal } = terminalResult;

  // Zámerne "best effort" dekódovanie LEN kvôli employee_id pre rate limit —
  // ak token nie je platný, rate limit podľa zamestnanca sa jednoducho
  // nevyhodnotí (IP strop platí aj tak) a skutočné zamietnutie príde nižšie
  // v processPunch, ktorý JWT overuje nanovo a poriadne (body 3–4).
  const tokenPreview = await verifyQrToken(body.token, { allowExpired: false });
  const employeeId = tokenPreview.ok ? tokenPreview.employeeId : null;
  const ip = getClientIp(request.headers);

  const rateLimit = await checkPunchRateLimit(employeeId, ip);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimit.reason }, { status: 429 });
  }

  const occurredAt = new Date(body.timestamp);
  const effectiveOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

  // 3–9: JWT platnosť, anti-replay, smer, zápis, prepočet attendance_days.
  // Online cesta NIKDY netoleruje vypršaný token (allowExpiredJwt: false).
  const result = await processPunch({
    token: body.token,
    occurredAt: effectiveOccurredAt,
    terminalId: terminal.id,
    workplaceId: terminal.workplaceId,
    isOfflineSync: false,
    allowExpiredJwt: false,
    ip,
  });

  if (!result.ok) {
    const status = result.reason === "already_used" ? 409 : result.reason === "employee_not_found" ? 404 : 401;
    const error =
      result.reason === "expired_token"
        ? "QR kód vypršal, naskenuj nový."
        : result.reason === "already_used"
          ? "QR kód už bol použitý."
          : result.reason === "employee_not_found"
            ? "Zamestnanec neexistuje."
            : "Neplatný QR kód.";
    return NextResponse.json({ error }, { status });
  }

  await adminDb.update(terminals).set({ lastSeenAt: new Date() }).where(eq(terminals.id, terminal.id));

  // 10: meno + čas na displej
  return NextResponse.json({
    employeeName: result.employeeName,
    direction: result.direction,
    kind: result.kind,
    time: result.occurredAt.toLocaleTimeString("sk-SK", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Bratislava",
    }),
  });
}

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
// eslint-disable-next-line no-restricted-imports -- zápis do punch_events ide vždy cez service role (schema.sql: "zápis ide cez service role, nie cez klienta"), aj keď je volajúci prihlásený session-om — rovnaká výnimka ako terminálový POST /api/punch
import { adminDb } from "@/lib/db/admin";
import { employees, employeeWorkplaces, punchEvents, workplaces } from "@/lib/db/schema";
import { determineDirection, recomputeAttendanceDay } from "@/lib/punch/attendance";
import { haversineDistanceMeters } from "@/lib/punch/geo";
import type { PunchKind } from "@/lib/punch/qr-token";
import { checkPunchRateLimit } from "@/lib/punch/rate-limit";
import { getClientIp } from "@/lib/shared/client-ip";
import { localDateStr } from "@/lib/shared/time";

type WebPunchBody = {
  workplaceId: string;
  kind: PunchKind;
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracyM?: number;
};

function parseBody(body: unknown): WebPunchBody | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.workplaceId !== "string" || !b.workplaceId) return null;
  const kind: PunchKind = b.kind === "prestavka" ? "prestavka" : "zmena";
  const gpsLat = typeof b.gpsLat === "number" ? b.gpsLat : undefined;
  const gpsLng = typeof b.gpsLng === "number" ? b.gpsLng : undefined;
  const gpsAccuracyM = typeof b.gpsAccuracyM === "number" ? b.gpsAccuracyM : undefined;
  return { workplaceId: b.workplaceId, kind, gpsLat, gpsLng, gpsAccuracyM };
}

/**
 * POST /api/punch/web — zamestnanec pípa priamo z webu (home
 * office). Rovnaké pravidlá ako QR terminál: povolenie na účte
 * (`employees.can_punch_web`), rate limiting, `determineDirection` podľa
 * posledného razítka toho istého dňa, zápis do `punch_events`. Jediný rozdiel
 * oproti termináli je vstupný bod (tlačidlo namiesto QR skenu) — bez
 * HMAC/JWT overenia, lebo tu identitu už zaručuje prihlásená session.
 *
 * GPS je len SOFT signál: mimo okruhu razítko PREJDE, len sa označí
 * `gps_suspicious`. GPS sa nikdy nesmie stať dôvodom na zamietnutie.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Neprihlásený." }, { status: 401 });
  }

  const body = parseBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  }

  const employee = await withUserContext(user.id, async (tx) => {
    const [row] = await tx.select().from(employees).where(eq(employees.userId, user.id));
    if (!row) return null;

    const [membership] = await tx
      .select({ workplaceId: employeeWorkplaces.workplaceId })
      .from(employeeWorkplaces)
      .where(and(eq(employeeWorkplaces.employeeId, row.id), eq(employeeWorkplaces.workplaceId, body.workplaceId)));

    return membership ? row : null;
  });

  if (!employee) {
    return NextResponse.json({ error: "Nie si priradený/á k tejto prevádzke." }, { status: 403 });
  }

  if (!employee.canPunchWeb) {
    return NextResponse.json({ error: "Web-pípanie nemáš povolené." }, { status: 403 });
  }

  const ip = getClientIp(request.headers);
  const rateLimit = await checkPunchRateLimit(employee.id, ip);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: rateLimit.reason }, { status: 429 });
  }

  const [workplace] = await adminDb
    .select({ gpsLat: workplaces.gpsLat, gpsLng: workplaces.gpsLng, gpsRadiusM: workplaces.gpsRadiusM })
    .from(workplaces)
    .where(eq(workplaces.id, body.workplaceId));

  let gpsDistanceM: number | null = null;
  let gpsSuspicious = false;
  if (workplace?.gpsLat != null && workplace.gpsLng != null && body.gpsLat != null && body.gpsLng != null) {
    gpsDistanceM = haversineDistanceMeters(
      Number(workplace.gpsLat),
      Number(workplace.gpsLng),
      body.gpsLat,
      body.gpsLng,
    );
    const radius = workplace.gpsRadiusM ?? 150;
    gpsSuspicious = gpsDistanceM > radius;
  }

  const occurredAt = new Date();
  const dateStr = localDateStr(occurredAt);

  const result = await adminDb.transaction(async (tx) => {
    const { direction, attendanceDate } = await determineDirection(tx, employee.id, body.workplaceId, dateStr, body.kind);

    await tx.insert(punchEvents).values({
      employeeId: employee.id,
      workplaceId: body.workplaceId,
      direction,
      method: "web",
      kind: body.kind,
      occurredAt,
      gpsLat: body.gpsLat != null ? String(body.gpsLat) : null,
      gpsLng: body.gpsLng != null ? String(body.gpsLng) : null,
      gpsAccuracyM: body.gpsAccuracyM != null ? String(body.gpsAccuracyM) : null,
      gpsDistanceM: gpsDistanceM != null ? gpsDistanceM.toFixed(2) : null,
      gpsSuspicious,
      createdBy: user.id,
    });

    // attendanceDate, NIE nutne dateStr — ranné odpípanie nočnej zmeny patrí VČEREJŠKU (lib/punch/attendance.ts).
    await recomputeAttendanceDay(tx, employee.id, body.workplaceId, attendanceDate);

    return { direction };
  });

  return NextResponse.json({
    direction: result.direction,
    kind: body.kind,
    time: occurredAt.toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bratislava" }),
    gpsSuspicious,
  });
}

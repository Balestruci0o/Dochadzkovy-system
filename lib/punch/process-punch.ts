import { and, eq, isNull } from "drizzle-orm";
// eslint-disable-next-line no-restricted-imports -- terminál sa autentifikuje HMAC podpisom, nie Supabase session — žiadny app.user_id neexistuje (docs/ARCHITECTURE.md, service role výnimka pre POST /api/punch)
import { adminDb } from "@/lib/db/admin";
import { employees, punchEvents, qrTokens } from "@/lib/db/schema";
import { localDateStr } from "@/lib/shared/time";
import { determineDirection, recomputeAttendanceDay } from "./attendance";
import { verifyQrToken } from "./qr-token";

export type ProcessPunchInput = {
  token: string;
  /** Kedy sa razítko STALO — z terminálu, nie čas prijatia servera (kritické pre offline sync). */
  occurredAt: Date;
  terminalId: string;
  workplaceId: string;
  isOfflineSync: boolean;
  /** true len pre /api/punch/sync — online cesta (/api/punch) toleranciu nikdy nepoužíva. */
  allowExpiredJwt: boolean;
  /** Klientská IP terminálu — len /api/punch ju pozná zmysluplne (rate limiting). */
  ip?: string | null;
};

export type ProcessPunchResult =
  | { ok: true; employeeName: string; direction: "in" | "out"; kind: "zmena" | "prestavka"; occurredAt: Date }
  | { ok: false; reason: "invalid_token" | "expired_token" | "already_used" | "employee_not_found" };

/**
 * Spoločné jadro (JWT platnosť → anti-replay →
 * smer → zápis → prepočet), zdieľané online endpointom (`/api/punch`) aj
 * offline dávkou (`/api/punch/sync`). HMAC podpis terminálu a "je terminál
 * aktívny" (body 1–2) MUSÍ overiť volajúci PRED zavolaním tejto funkcie —
 * tu už `terminalId`/`workplaceId` berieme ako dôveryhodné.
 */
export async function processPunch(input: ProcessPunchInput): Promise<ProcessPunchResult> {
  // 3–4: JWT podpis platný (vždy) a nevypršal (len ak allowExpiredJwt=false)
  const tokenResult = await verifyQrToken(input.token, { allowExpired: input.allowExpiredJwt });
  if (!tokenResult.ok) {
    return { ok: false, reason: tokenResult.reason === "expired" ? "expired_token" : "invalid_token" };
  }
  const { employeeId, jti, kind } = tokenResult;

  // 5–6: jti nebol ešte minutý, označ ho ako použitý — atomicky (WHERE used_at IS NULL).
  // Toto je JEDINÁ obrana proti duplicitám aj pri offline sync.
  const [claimed] = await adminDb
    .update(qrTokens)
    .set({ usedAt: new Date(), usedByTerminal: input.terminalId })
    .where(and(eq(qrTokens.jti, jti), isNull(qrTokens.usedAt)))
    .returning();
  if (!claimed) {
    return { ok: false, reason: "already_used" };
  }

  const [employee] = await adminDb
    .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!employee) {
    return { ok: false, reason: "employee_not_found" };
  }

  const dateStr = localDateStr(input.occurredAt);

  const direction = await adminDb.transaction(async (tx) => {
    // 7: smer podľa posledného razítka dňa TOHTO ISTÉHO kind (aj rannej nočnej zmeny z včerajška, viď attendance.ts)
    const { direction: dir, attendanceDate } = await determineDirection(tx, employee.id, input.workplaceId, dateStr, kind);

    // 8: zapíš punch_events (append-only)
    await tx.insert(punchEvents).values({
      employeeId: employee.id,
      workplaceId: input.workplaceId,
      direction: dir,
      method: "qr_terminal",
      kind,
      occurredAt: input.occurredAt,
      terminalId: input.terminalId,
      qrTokenJti: jti,
      isOfflineSync: input.isOfflineSync,
      ip: input.ip ?? null,
    });

    // 9: prepočítaj attendance_days — attendanceDate, NIE nutne dateStr (nočná zmena patrí včerajšku)
    await recomputeAttendanceDay(tx, employee.id, input.workplaceId, attendanceDate);

    return dir;
  });

  return {
    ok: true,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    direction,
    kind,
    occurredAt: input.occurredAt,
  };
}

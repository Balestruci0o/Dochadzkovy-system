import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { employees, qrTokens } from "@/lib/db/schema";
import { issueQrToken, type PunchKind } from "@/lib/punch/qr-token";

/**
 * GET /api/qr-token — vydá rotujúci JWT pre prihláseného
 * zamestnanca. Volá ho klientský JS na `/punch` každých 25 s (token platí 30 s,
 * 5 s rezerva). Bežná session-autentifikovaná cesta (nie terminál) — preto
 * `withUserContext`, nie `adminDb`.
 *
 * Pípanie prestávok, krok 3 — `?kind=prestavka` vydá druhý QR kód (default
 * "zmena" zachováva presne dnešné správanie pre existujúce volania bez
 * parametra).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Neprihlásený." }, { status: 401 });
  }

  const kindParam = new URL(request.url).searchParams.get("kind");
  const kind: PunchKind = kindParam === "prestavka" ? "prestavka" : "zmena";

  const employee = await withUserContext(user.id, async (tx) => {
    const [row] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id));
    return row ?? null;
  });

  if (!employee) {
    return NextResponse.json({ error: "K tomuto účtu nie je priradený žiadny zamestnanec." }, { status: 403 });
  }

  const { token, jti, expiresAt } = await issueQrToken(employee.id, kind);

  await withUserContext(user.id, (tx) => tx.insert(qrTokens).values({ jti, employeeId: employee.id, expiresAt }));

  return NextResponse.json({ token, expiresAt: expiresAt.toISOString() });
}

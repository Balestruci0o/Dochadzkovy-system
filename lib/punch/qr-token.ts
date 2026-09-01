import { errors, jwtVerify, SignJWT } from "jose";

/**
 * Rotujúci QR token. JWT s krátkou platnosťou (30 s), payload
 * `{employeeId, jti, kind}`. `jti` je zároveň primárny kľúč v `qr_tokens` —
 * anti-replay sa nerieši len JWT platnosťou, ale tým, že sa `jti` dá minúť
 * len raz (atomický UPDATE v punch endpointe).
 *
 * Pípanie prestávok, krok 3 — `kind` ("zmena"/"prestavka") rozlišuje DVA
 * rotujúce QR kódy na `/punch`. Default "zmena" zachováva presne dnešné
 * správanie — starý payload bez `kind` (napr. token vydaný tesne pred
 * deployom tejto zmeny) sa pri verifikácii vyhodnotí rovnako.
 */

const TOKEN_TTL_SECONDS = 30;

export type PunchKind = "zmena" | "prestavka";

function getSecretKey(): Buffer {
  const key = process.env.QR_TOKEN_SECRET;
  if (!key) throw new Error("QR_TOKEN_SECRET nie je nastavená");
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) throw new Error("QR_TOKEN_SECRET musí byť presne 32 bajtov (base64)");
  return buf;
}

export async function issueQrToken(
  employeeId: string,
  kind: PunchKind = "zmena",
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_SECONDS * 1000);

  const token = await new SignJWT({ employeeId, kind })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getSecretKey());

  return { token, jti, expiresAt };
}

export type QrTokenVerifyResult =
  | { ok: true; employeeId: string; jti: string; kind: PunchKind; expired: false }
  | { ok: true; employeeId: string; jti: string; kind: PunchKind; expired: true }
  | { ok: false; reason: "invalid_signature" | "malformed" | "expired" };

/**
 * `allowExpired`: offline sync (7e) overuje razítka, ktoré terminál naskenoval
 * dávno predtým, než sa dostal k odoslaniu — ich JWT `exp` bude vždy vypršaný.
 * Podpis sa MUSÍ aj tak overiť (dôkaz, že token naozaj vydal server), len sa
 * toleruje vypršanie. jose pri `JWTExpired` chybe už MÁ overený payload
 * (podpis sa kontroluje pred exp), takže sa dá bezpečne prevziať z chyby.
 */
export async function verifyQrToken(token: string, opts?: { allowExpired?: boolean }): Promise<QrTokenVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (typeof payload.employeeId !== "string" || typeof payload.jti !== "string") {
      return { ok: false, reason: "malformed" };
    }
    const kind: PunchKind = payload.kind === "prestavka" ? "prestavka" : "zmena";
    return { ok: true, employeeId: payload.employeeId, jti: payload.jti, kind, expired: false };
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      if (opts?.allowExpired) {
        const payload = err.payload;
        if (typeof payload.employeeId !== "string" || typeof payload.jti !== "string") {
          return { ok: false, reason: "malformed" };
        }
        const kind: PunchKind = payload.kind === "prestavka" ? "prestavka" : "zmena";
        return { ok: true, employeeId: payload.employeeId, jti: payload.jti, kind, expired: true };
      }
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid_signature" };
  }
}

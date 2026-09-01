import { eq } from "drizzle-orm";
// eslint-disable-next-line no-restricted-imports -- terminál sa autentifikuje HMAC podpisom, nie Supabase session — žiadny app.user_id neexistuje (docs/ARCHITECTURE.md, service role výnimka pre POST /api/punch)
import { adminDb } from "@/lib/db/admin";
import { terminals } from "@/lib/db/schema";
import { decryptTerminalSecret, verifyHmac } from "./hmac";

export type TerminalVerifyResult =
  | { ok: true; terminal: { id: string; workplaceId: string } }
  | { ok: false; reason: "bad_signature" | "inactive_terminal" };

/**
 * Over HMAC podpis PRED tým, než čokoľvek povieš o
 * stave terminálu. Neznámy `device_id` a zlý podpis vrátia rovnaký dôvod
 * (`bad_signature`) — nechceme cudziemu volajúcemu prezradiť, ktoré device_id
 * existujú.
 */
export async function verifyTerminalRequest(
  deviceId: string,
  message: string,
  providedHmac: string,
): Promise<TerminalVerifyResult> {
  const [terminal] = await adminDb.select().from(terminals).where(eq(terminals.deviceId, deviceId));
  if (!terminal) {
    return { ok: false, reason: "bad_signature" };
  }

  let secret: string;
  try {
    secret = decryptTerminalSecret(terminal.secretHash);
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  if (!verifyHmac(secret, message, providedHmac)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (!terminal.isActive) {
    return { ok: false, reason: "inactive_terminal" };
  }

  return { ok: true, terminal: { id: terminal.id, workplaceId: terminal.workplaceId } };
}

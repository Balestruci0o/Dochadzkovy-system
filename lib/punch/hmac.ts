import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Terminál sa autentifikuje HMAC-SHA256 podpisom nad kanonickou správou,
 * počítaným ich zdieľaným tajomstvom (docs/ARCHITECTURE.md sekcia 3).
 * Server preto MUSÍ vedieť tajomstvo v plaintexte, aby si vedel podpis sám
 * prepočítať a porovnať — jednosmerný hash (pôvodné riešenie) na to nestačí.
 * `terminals.secret_hash` preto obsahuje AES-256-GCM
 * šifrotext, nie SHA-256 hash — názov stĺpca zostáva podľa schema.sql, len
 * obsah je iný.
 */

const ALGO = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const key = process.env.TERMINAL_SECRET_ENCRYPTION_KEY;
  if (!key) throw new Error("TERMINAL_SECRET_ENCRYPTION_KEY nie je nastavená");
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("TERMINAL_SECRET_ENCRYPTION_KEY musí byť presne 32 bajtov (base64)");
  }
  return buf;
}

/** Zašifruje tajomstvo terminálu pre uloženie do `terminals.secret_hash`. */
export function encryptTerminalSecret(plaintextSecret: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextSecret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(".");
}

/** Dešifruje tajomstvo terminálu — LEN pre punch endpoint pri overovaní HMAC. */
export function decryptTerminalSecret(stored: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("secret_hash má neplatný formát (očakávané iv.tag.ciphertext)");
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Kanonická správa, ktorú terminál podpisuje — presne v tomto poradí a s
 * touto interpunkciou. Zmena tvaru je BREAKING CHANGE pre firmvér (Blok 13).
 */
export function canonicalPunchMessage(deviceId: string, token: string, timestamp: string): string {
  return `${deviceId}.${token}.${timestamp}`;
}

export function computeHmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** Porovnanie v konštantnom čase — obyčajné `===` by unikalo časovaním. */
export function verifyHmac(secret: string, message: string, providedHex: string): boolean {
  const expectedHex = computeHmac(secret, message);
  const expected = Buffer.from(expectedHex, "hex");
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, "hex");
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

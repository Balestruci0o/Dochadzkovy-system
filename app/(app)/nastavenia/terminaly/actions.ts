"use server";

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { terminals } from "@/lib/db/schema";
import { encryptTerminalSecret } from "@/lib/punch/hmac";

export type ActionState = { error?: string; success?: boolean; plaintextSecret?: string };

// Tajomstvo sa vygeneruje tu, vráti sa RAZ v `plaintextSecret` (klient ho
// zobrazí a už nikdy nezíska späť) — do DB ide zašifrovaná verzia
// (`encryptTerminalSecret`, AES-256-GCM). NIE jednosmerný hash — punch
// endpoint (Blok 7) potrebuje plaintext na prepočítanie HMAC podpisu
// terminálu, čo hash neumožňuje.
export async function createTerminalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageTerminals");

  const workplaceId = String(formData.get("workplaceId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const deviceId = String(formData.get("deviceId") ?? "").trim();

  if (!workplaceId) return { error: "Vyber prevádzku." };
  if (!name) return { error: "Vyplň názov terminálu." };
  if (!deviceId) return { error: "Vyplň HW identifikátor (device ID) terminálu." };

  const plaintextSecret = randomBytes(32).toString("base64url");
  const secretHash = encryptTerminalSecret(plaintextSecret);

  try {
    await withUserContext(user.id, (tx) =>
      tx.insert(terminals).values({ workplaceId, name, deviceId, secretHash }),
    );
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(String((err as { cause?: unknown }).cause ?? err.message))) {
      return { error: "Terminál s týmto device ID už existuje." };
    }
    throw err;
  }

  revalidatePath("/nastavenia/terminaly");
  return { success: true, plaintextSecret };
}

// Vygeneruje NOVÉ tajomstvo pre existujúci terminál (napr. pri podozrení na
// únik) — starý hash sa prepíše, staré tajomstvo prestane fungovať okamžite.
export async function regenerateTerminalSecretAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageTerminals");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID terminálu." };

  const plaintextSecret = randomBytes(32).toString("base64url");
  const secretHash = encryptTerminalSecret(plaintextSecret);

  await withUserContext(user.id, (tx) => tx.update(terminals).set({ secretHash }).where(eq(terminals.id, id)));

  revalidatePath("/nastavenia/terminaly");
  return { success: true, plaintextSecret };
}

export async function toggleTerminalActiveAction(formData: FormData) {
  const user = await requirePermission("manageTerminals");
  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) => tx.update(terminals).set({ isActive: nextActive }).where(eq(terminals.id, id)));

  revalidatePath("/nastavenia/terminaly");
}

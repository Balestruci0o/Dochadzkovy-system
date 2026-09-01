"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { legalRules } from "@/lib/db/schema";
import { isForeignKeyViolation, requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";

export type ActionState = { error?: string; success?: boolean };

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    /duplicate key value violates unique constraint/.test(String((err as { cause?: unknown }).cause ?? err.message))
  );
}

/**
 * Blok 14, bod 2 — owner doteraz vedel len upravovať EXISTUJÚCE §ZP pravidlá
 * (`updateLegalRuleAction` nižšie), nikdy pridať nové. Parametre sú páry
 * kľúč/hodnota bez pevného zoznamu — formulár posiela
 * `paramKey[]`/`paramValue[]` rovnakej dĺžky, nie fixné polia.
 */
export async function createLegalRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const lawReference = String(formData.get("lawReference") ?? "").trim() || null;
  const isHard = formData.get("isHard") === "true";

  if (!code) return { error: "Vyplň kód pravidla." };
  if (!name) return { error: "Vyplň názov pravidla." };

  const paramKeys = formData.getAll("paramKey").map(String);
  const paramValues = formData.getAll("paramValue").map(String);
  const params: Record<string, number> = {};
  for (let i = 0; i < paramKeys.length; i++) {
    const key = paramKeys[i].trim();
    if (!key) continue;
    const n = Number(paramValues[i]?.replace(",", "."));
    if (!Number.isFinite(n)) return { error: `Hodnota pre „${key}“ musí byť číslo.` };
    params[key] = n;
  }
  if (Object.keys(params).length === 0) return { error: "Pridaj aspoň jeden parameter." };

  try {
    await withUserContext(user.id, (tx) => tx.insert(legalRules).values({ orgId: user.orgId, code, name, params, isHard, lawReference }));
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { error: `Pravidlo s kódom „${code}“ už v tejto organizácii existuje.` };
    }
    throw err;
  }

  revalidatePath("/nastavenia/pravidla");
  return { success: true };
}

// §ZP pravidlá sú dáta — parametre editujeme generic
// podľa kľúčov, ktoré už v `params` existujú, nie podľa zadrátovaného zoznamu
// kódov. Formulár posiela `param__<kľúč>` pre každý existujúci kľúč.
export async function updateLegalRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID pravidla." };

  const params: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("param__")) continue;
    const paramKey = key.slice("param__".length);
    const n = Number(String(value).replace(",", "."));
    if (!Number.isFinite(n)) return { error: `Hodnota pre "${paramKey}" musí byť číslo.` };
    params[paramKey] = n;
  }
  if (Object.keys(params).length === 0) return { error: "Pravidlo nemá žiadne parametre na úpravu." };

  const isHard = formData.get("isHard") === "true";

  await withUserContext(user.id, (tx) =>
    tx.update(legalRules).set({ params, isHard }).where(eq(legalRules.id, id)),
  );

  revalidatePath("/nastavenia/pravidla");
  return { success: true };
}

export async function toggleLegalRuleActiveAction(formData: FormData) {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) => tx.update(legalRules).set({ isActive: nextActive }).where(eq(legalRules.id, id)));

  revalidatePath("/nastavenia/pravidla");
}

/**
 * Blok 14, bod 1 — nič neodkazuje na `legal_rules.id` (žiadna FK) — generátor
 * číta pravidlá podľa `code` (text), nie ID. Zmazanie teda Postgres nikdy
 * nezablokuje, ALE ak ide o kód, ktorý generátor reálne pozná
 * (MAX_WEEKLY_HOURS, MIN_REST_DAILY, MIN_REST_WEEKLY, MAX_CONSEC_DAYS,
 * MAX_SHIFT_HOURS, BREAK_AFTER_HOURS), zmazanie ho ÚPLNE prestane
 * zohľadňovať — na rozdiel od deaktivácie (`isActive=false`, čo generátor
 * rovnako ignoruje, ale záznam parametrov ostáva pre prípadné obnovenie).
 * Toto varovanie je v potvrdzovacom kroku UI (`legal-rule-list.tsx`), nie tu.
 */
export async function requestDeleteLegalRuleCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID pravidla." };

  const [rule] = await withUserContext(user.id, (tx) => tx.select({ name: legalRules.name, code: legalRules.code }).from(legalRules).where(eq(legalRules.id, id)));
  if (!rule) return { error: "Pravidlo neexistuje." };

  await requestDeleteCode(user, "legal_rule", id, `§ZP pravidlo „${rule.name}“ (${rule.code})`);
  return {};
}

export async function confirmDeleteLegalRuleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!id) return { error: "Chýba ID pravidla." };

  const verify = await verifyDeleteCode(user, "legal_rule", id, code);
  if (!verify.ok) return { error: verify.error };

  try {
    await withUserContext(user.id, (tx) => tx.delete(legalRules).where(eq(legalRules.id, id)));
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return { error: "Toto pravidlo nemožno zmazať — používa sa inde. Namiesto mazania ho deaktivuj." };
    }
    throw err;
  }

  revalidatePath("/nastavenia/pravidla");
  return { success: true };
}

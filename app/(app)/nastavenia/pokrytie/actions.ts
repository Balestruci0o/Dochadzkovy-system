"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { coverageRequirements, positions } from "@/lib/db/schema";
import { isForeignKeyViolation, requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";

export type ActionState = { error?: string; success?: boolean };

function readFields(formData: FormData) {
  const weekdays = formData
    .getAll("weekdays")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const maxPeopleRaw = String(formData.get("maxPeople") ?? "").trim();

  return {
    workplaceId: String(formData.get("workplaceId") ?? "").trim(),
    positionId: String(formData.get("positionId") ?? "").trim() || null,
    // Povinné pri KAŽDOM novom/upravenom
    // pravidle, aj keď stĺpec sám je v DB nullable (historické riadky bez
    // väzby ostávajú tak, kým ich niekto neupraví).
    shiftTemplateId: String(formData.get("shiftTemplateId") ?? "").trim(),
    minPeople: Math.max(0, Number(formData.get("minPeople") ?? 1) || 1),
    maxPeople: maxPeopleRaw ? Math.max(0, Number(maxPeopleRaw)) : null,
    weekdays,
    appliesHolidays: formData.get("appliesHolidays") === "on",
    isHard: formData.get("isHard") === "true",
  };
}

export async function createCoverageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");
  const f = readFields(formData);

  if (!f.workplaceId) return { error: "Vyber prevádzku." };
  if (!f.shiftTemplateId) return { error: "Vyber smenu — bez nej generátor toto pravidlo nevidí." };
  if (f.weekdays.length === 0) return { error: "Vyber aspoň jeden deň v týždni." };

  await withUserContext(user.id, (tx) => tx.insert(coverageRequirements).values(f));

  revalidatePath("/nastavenia/pokrytie");
  return { success: true };
}

export async function updateCoverageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID pravidla pokrytia." };
  const f = readFields(formData);

  if (!f.shiftTemplateId) return { error: "Vyber smenu — bez nej generátor toto pravidlo nevidí." };
  if (f.weekdays.length === 0) return { error: "Vyber aspoň jeden deň v týždni." };

  await withUserContext(user.id, (tx) =>
    tx
      .update(coverageRequirements)
      .set({
        positionId: f.positionId,
        shiftTemplateId: f.shiftTemplateId,
        minPeople: f.minPeople,
        maxPeople: f.maxPeople,
        weekdays: f.weekdays,
        appliesHolidays: f.appliesHolidays,
        isHard: f.isHard,
      })
      .where(eq(coverageRequirements.id, id)),
  );

  revalidatePath("/nastavenia/pokrytie");
  return { success: true };
}

export async function toggleCoverageActiveAction(formData: FormData) {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) =>
    tx.update(coverageRequirements).set({ isActive: nextActive }).where(eq(coverageRequirements.id, id)),
  );

  revalidatePath("/nastavenia/pokrytie");
}

/**
 * Blok 14, bod 1 — nič neodkazuje na `coverage_requirements.id` (žiadna FK),
 * mazanie teda nemá čo zablokovať. Try/catch ostáva ako obranná poistka
 * (rovnaký vzor ako ostatné 4 entity), nie preto, že by reálne mala nastať.
 */
export async function requestDeleteCoverageCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID pravidla pokrytia." };

  const [row] = await withUserContext(user.id, (tx) =>
    tx
      .select({ minPeople: coverageRequirements.minPeople, positionName: positions.name })
      .from(coverageRequirements)
      .leftJoin(positions, eq(positions.id, coverageRequirements.positionId))
      .where(eq(coverageRequirements.id, id)),
  );
  if (!row) return { error: "Pravidlo pokrytia neexistuje." };

  await requestDeleteCode(user, "coverage_requirement", id, `Pokrytie „${row.positionName ?? "Ktokoľvek"}, min. ${row.minPeople}“`);
  return {};
}

export async function confirmDeleteCoverageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("manageRules");
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!id) return { error: "Chýba ID pravidla pokrytia." };

  const verify = await verifyDeleteCode(user, "coverage_requirement", id, code);
  if (!verify.ok) return { error: verify.error };

  try {
    await withUserContext(user.id, (tx) => tx.delete(coverageRequirements).where(eq(coverageRequirements.id, id)));
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return { error: "Toto pravidlo pokrytia nemožno zmazať — používa sa inde. Namiesto mazania ho deaktivuj." };
    }
    throw err;
  }

  revalidatePath("/nastavenia/pokrytie");
  return { success: true };
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { shiftTemplates } from "@/lib/db/schema";
import { isForeignKeyViolation, requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";
import { resolveTemplateBreakMinutes } from "@/lib/shared/break-config";

export type ActionState = { error?: string; success?: boolean };

function readFields(formData: FormData) {
  const breakMode = formData.get("breakMode") === "presny_cas" ? ("presny_cas" as const) : ("minuty" as const);
  const breakMinutesRaw = Number(formData.get("breakMinutes") ?? 30) || 0;
  const breakStartTime = String(formData.get("breakStartTime") ?? "").trim() || null;
  const breakEndTime = String(formData.get("breakEndTime") ?? "").trim() || null;

  return {
    workplaceId: String(formData.get("workplaceId") ?? "").trim(),
    name: String(formData.get("name") ?? "").trim(),
    code: String(formData.get("code") ?? "").trim().toUpperCase(),
    startTime: String(formData.get("startTime") ?? "").trim(),
    endTime: String(formData.get("endTime") ?? "").trim(),
    crossesMidnight: formData.get("crossesMidnight") === "on",
    breakMode,
    breakStartTime,
    breakEndTime,
    // MATERIALIZOVANÉ na aktuálnu efektívnu hodnotu (Blok "pípanie prestávok",
    // krok 1) — generátor aj kalendár čítajú tento stĺpec priamo, nemusia
    // vedieť o breakMode/breakStartTime/breakEndTime vôbec.
    breakMinutes: resolveTemplateBreakMinutes({ breakMode, breakMinutes: breakMinutesRaw, breakStartTime, breakEndTime }),
    color: String(formData.get("color") ?? "").trim() || null,
  };
}

export async function createShiftTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("managePositionsShifts");
  const f = readFields(formData);

  if (!f.workplaceId) return { error: "Vyber prevádzku." };
  if (!f.name || !f.code) return { error: "Vyplň názov aj kód šablóny." };
  if (!f.startTime || !f.endTime) return { error: "Vyplň čas od aj do." };
  if (f.breakMode === "presny_cas" && (!f.breakStartTime || !f.breakEndTime)) {
    return { error: "Vyplň presný čas prestávky od aj do." };
  }

  await withUserContext(user.id, (tx) => tx.insert(shiftTemplates).values(f));

  revalidatePath("/nastavenia/zmeny");
  return { success: true };
}

export async function updateShiftTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID šablóny." };
  const f = readFields(formData);

  if (!f.name || !f.code) return { error: "Vyplň názov aj kód šablóny." };
  if (!f.startTime || !f.endTime) return { error: "Vyplň čas od aj do." };
  if (f.breakMode === "presny_cas" && (!f.breakStartTime || !f.breakEndTime)) {
    return { error: "Vyplň presný čas prestávky od aj do." };
  }

  await withUserContext(user.id, (tx) =>
    tx
      .update(shiftTemplates)
      .set({
        name: f.name,
        code: f.code,
        startTime: f.startTime,
        endTime: f.endTime,
        crossesMidnight: f.crossesMidnight,
        breakMode: f.breakMode,
        breakStartTime: f.breakStartTime,
        breakEndTime: f.breakEndTime,
        breakMinutes: f.breakMinutes,
        color: f.color,
      })
      .where(eq(shiftTemplates.id, id)),
  );

  revalidatePath("/nastavenia/zmeny");
  return { success: true };
}

export async function toggleShiftTemplateActiveAction(formData: FormData) {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) =>
    tx.update(shiftTemplates).set({ isActive: nextActive }).where(eq(shiftTemplates.id, id)),
  );

  revalidatePath("/nastavenia/zmeny");
}

/**
 * Blok 14, bod 1 — `scheduled_shifts.shift_template_id` a
 * `employee_shift_templates` (preferovaná zmena) nemajú ON DELETE, ktoré by
 * ticho zmazalo/prepísalo — šablónu POUŽITÚ v aspoň jednom rozvrhu Postgres
 * zablokuje. `coverage_requirements.shift_template_id` je SET NULL (zámerne,
 * viď schema.ts) — tam sa mazanie NEBLOKUJE, len sa odpojí.
 */
export async function requestDeleteShiftTemplateCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID šablóny." };

  const [template] = await withUserContext(user.id, (tx) => tx.select({ name: shiftTemplates.name }).from(shiftTemplates).where(eq(shiftTemplates.id, id)));
  if (!template) return { error: "Šablóna neexistuje." };

  await requestDeleteCode(user, "shift_template", id, `Šablóna smeny „${template.name}“`);
  return {};
}

export async function confirmDeleteShiftTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!id) return { error: "Chýba ID šablóny." };

  const verify = await verifyDeleteCode(user, "shift_template", id, code);
  if (!verify.ok) return { error: verify.error };

  try {
    await withUserContext(user.id, (tx) => tx.delete(shiftTemplates).where(eq(shiftTemplates.id, id)));
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return { error: "Túto šablónu nemožno zmazať — používa sa aspoň v jednom rozvrhu. Namiesto mazania ju deaktivuj." };
    }
    throw err;
  }

  revalidatePath("/nastavenia/zmeny");
  return { success: true };
}

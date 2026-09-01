"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { workplaces } from "@/lib/db/schema";
import { isForeignKeyViolation, requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";

export type ActionState = { error?: string; success?: boolean };

function parseDays(formData: FormData): number[] {
  return formData
    .getAll("operatingDays")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

function parseNumeric(value: FormDataEntryValue | null): string | null {
  const s = String(value ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? s : null;
}

export async function createWorkplaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const timezone = String(formData.get("timezone") ?? "").trim() || "Europe/Bratislava";
  const operatingDays = parseDays(formData);
  const operatesHolidays = formData.get("operatesHolidays") === "on";
  const gpsLat = parseNumeric(formData.get("gpsLat"));
  const gpsLng = parseNumeric(formData.get("gpsLng"));
  const gpsRadiusM = parseNumeric(formData.get("gpsRadiusM"));

  if (!name || !code) return { error: "Vyplň názov aj kód prevádzky." };
  if (operatingDays.length === 0) return { error: "Vyber aspoň jeden prevádzkový deň." };

  await withUserContext(user.id, (tx) =>
    tx.insert(workplaces).values({
      orgId: user.orgId,
      name,
      code,
      timezone,
      operatingDays,
      operatesHolidays,
      gpsLat,
      gpsLng,
      gpsRadiusM: gpsRadiusM ? Math.round(Number(gpsRadiusM)) : 150,
    }),
  );

  revalidatePath("/nastavenia/prevadzky");
  return { success: true };
}

export async function updateWorkplaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID prevádzky." };

  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const timezone = String(formData.get("timezone") ?? "").trim() || "Europe/Bratislava";
  const operatingDays = parseDays(formData);
  const operatesHolidays = formData.get("operatesHolidays") === "on";
  const gpsLat = parseNumeric(formData.get("gpsLat"));
  const gpsLng = parseNumeric(formData.get("gpsLng"));
  const gpsRadiusM = parseNumeric(formData.get("gpsRadiusM"));

  if (!name || !code) return { error: "Vyplň názov aj kód prevádzky." };
  if (operatingDays.length === 0) return { error: "Vyber aspoň jeden prevádzkový deň." };

  await withUserContext(user.id, (tx) =>
    tx
      .update(workplaces)
      .set({
        name,
        code,
        timezone,
        operatingDays,
        operatesHolidays,
        gpsLat,
        gpsLng,
        gpsRadiusM: gpsRadiusM ? Math.round(Number(gpsRadiusM)) : 150,
      })
      .where(eq(workplaces.id, id)),
  );

  revalidatePath("/nastavenia/prevadzky");
  return { success: true };
}

export async function toggleWorkplaceActiveAction(formData: FormData) {
  const user = await requireRole("owner");
  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) => tx.update(workplaces).set({ isActive: nextActive }).where(eq(workplaces.id, id)));

  revalidatePath("/nastavenia/prevadzky");
}

/**
 * Blok 14, bod 1 — prevádzka má NAJŠIRŠÍ dosah zo všetkých 5 entít: pozície,
 * šablóny zmien, pokrytie, zamestnanecké priradenia... všetko s
 * `ON DELETE cascade` na workplace_id. Ak sa ale kaskáda dostane k riadku,
 * ktorý ONE ACTION FK chráni (napr. pozícia s históriou zamestnanca,
 * šablóna použitá v rozvrhu), Postgres CELÚ transakciu zastaví — prevádzka
 * s akoukoľvek reálnou históriou sa teda zmazať nedá, len prázdna/testovacia.
 */
export async function requestDeleteWorkplaceCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requireRole("owner");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID prevádzky." };

  const [workplace] = await withUserContext(user.id, (tx) => tx.select({ name: workplaces.name }).from(workplaces).where(eq(workplaces.id, id)));
  if (!workplace) return { error: "Prevádzka neexistuje." };

  await requestDeleteCode(user, "workplace", id, `Prevádzka „${workplace.name}“`);
  return {};
}

export async function confirmDeleteWorkplaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner");
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!id) return { error: "Chýba ID prevádzky." };

  const verify = await verifyDeleteCode(user, "workplace", id, code);
  if (!verify.ok) return { error: verify.error };

  try {
    await withUserContext(user.id, (tx) => tx.delete(workplaces).where(eq(workplaces.id, id)));
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return {
        error:
          "Túto prevádzku nemožno zmazať — má históriu (zamestnanci, rozvrhy, pozície alebo šablóny s reálnym použitím). Namiesto mazania ju deaktivuj.",
      };
    }
    throw err;
  }

  revalidatePath("/nastavenia/prevadzky");
  return { success: true };
}

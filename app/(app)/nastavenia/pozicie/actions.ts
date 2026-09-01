"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { positions } from "@/lib/db/schema";
import { isForeignKeyViolation, requestDeleteCode, verifyDeleteCode } from "@/lib/settings/delete-with-code";

export type ActionState = { error?: string; success?: boolean };

function readBreakTrackingMode(formData: FormData) {
  return formData.get("breakTrackingMode") === "pipa" ? ("pipa" as const) : ("automaticky" as const);
}

function readPayMode(formData: FormData) {
  return formData.get("payMode") === "fixny" ? ("fixny" as const) : ("hodinovy" as const);
}

function readDepartureMode(formData: FormData) {
  return formData.get("departureMode") === "nepipa" ? ("nepipa" as const) : ("pipa" as const);
}

export async function createPositionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("managePositionsShifts");

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim() || null;
  const workplaceId = String(formData.get("workplaceId") ?? "").trim() || null;
  const breakTrackingMode = readBreakTrackingMode(formData);
  const payMode = readPayMode(formData);
  const departureMode = readDepartureMode(formData);
  const requiresShiftLeader = formData.get("requiresShiftLeader") === "on";

  if (!name) return { error: "Vyplň názov pozície." };

  await withUserContext(user.id, (tx) =>
    tx.insert(positions).values({ orgId: user.orgId, workplaceId, name, color, breakTrackingMode, payMode, departureMode, requiresShiftLeader }),
  );

  revalidatePath("/nastavenia/pozicie");
  return { success: true };
}

export async function updatePositionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID pozície." };

  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim() || null;
  const workplaceId = String(formData.get("workplaceId") ?? "").trim() || null;
  const breakTrackingMode = readBreakTrackingMode(formData);
  const payMode = readPayMode(formData);
  const departureMode = readDepartureMode(formData);
  const requiresShiftLeader = formData.get("requiresShiftLeader") === "on";

  if (!name) return { error: "Vyplň názov pozície." };

  await withUserContext(user.id, (tx) =>
    tx.update(positions).set({ name, color, workplaceId, breakTrackingMode, payMode, departureMode, requiresShiftLeader }).where(eq(positions.id, id)),
  );

  revalidatePath("/nastavenia/pozicie");
  return { success: true };
}

export async function togglePositionActiveAction(formData: FormData) {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  const nextActive = formData.get("nextActive") === "true";

  await withUserContext(user.id, (tx) => tx.update(positions).set({ isActive: nextActive }).where(eq(positions.id, id)));

  revalidatePath("/nastavenia/pozicie");
}

/**
 * Mazanie potvrdené kódom mailom. `employee_position_history.position_id`
 * nemá ON DELETE (história sa nestráca) — Postgres
 * sám zablokuje mazanie pozície, ktorú KEDYKOĽVEK držal aspoň jeden
 * zamestnanec; rovnako `coverage_requirements.position_id`. Chytáme tú istú
 * FK chybu a preložíme na zrozumiteľnú hlášku namiesto pádu.
 */
export async function requestDeletePositionCodeAction(formData: FormData): Promise<{ error?: string }> {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Chýba ID pozície." };

  const [position] = await withUserContext(user.id, (tx) => tx.select({ name: positions.name }).from(positions).where(eq(positions.id, id)));
  if (!position) return { error: "Pozícia neexistuje." };

  await requestDeleteCode(user, "position", id, `Pozícia „${position.name}“`);
  return {};
}

export async function confirmDeletePositionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePermission("managePositionsShifts");
  const id = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "");
  if (!id) return { error: "Chýba ID pozície." };

  const verify = await verifyDeleteCode(user, "position", id, code);
  if (!verify.ok) return { error: verify.error };

  try {
    await withUserContext(user.id, (tx) => tx.delete(positions).where(eq(positions.id, id)));
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      return { error: "Túto pozíciu nemožno zmazať — má ju história zamestnancov alebo ju používa pravidlo pokrytia. Namiesto mazania ju deaktivuj." };
    }
    throw err;
  }

  revalidatePath("/nastavenia/pozicie");
  return { success: true };
}

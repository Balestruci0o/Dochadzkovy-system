"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { absenceRequests, employees, employeeWorkplaces } from "@/lib/db/schema";
import { ABSENCE_KIND_CONFIG, type AbsenceKind } from "@/components/calendar/absence-kinds";
import { notifyAbsenceRequestSubmitted } from "@/lib/notifications/events";

export type ActionState = { error?: string; success?: boolean };

/**
 * Bod 1 — zamestnanec podá žiadosť. Vždy `status: "pending"`
 * — trigger (migrácia 0016/0017) ju OKAMŽITE materializuje do `absences`
 * ako `is_confirmed=false` (bod 7: nepotvrdená žiadosť UŽ blokuje generátor).
 */
export async function requestAbsenceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("employee");

  const kind = String(formData.get("kind") ?? "") as AbsenceKind;
  const dateFrom = String(formData.get("dateFrom") ?? "");
  const dateTo = String(formData.get("dateTo") ?? "") || dateFrom;
  const isPartialDay = formData.get("isPartialDay") === "true";
  const hoursRaw = String(formData.get("hours") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!kind || !dateFrom) return { error: "Vyplň druh a dátum." };
  if (dateTo < dateFrom) return { error: "Dátum 'do' musí byť rovnaký alebo neskorší než 'od'." };
  if (isPartialDay && (!hoursRaw || Number(hoursRaw) <= 0)) return { error: "Pri neprítomnosti na hodiny zadaj kladný počet hodín." };

  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id));
    if (!employee) return { error: "K tomuto účtu nie je priradený žiadny zamestnanec." };

    const [primaryWorkplace] = await tx
      .select({ workplaceId: employeeWorkplaces.workplaceId })
      .from(employeeWorkplaces)
      .where(and(eq(employeeWorkplaces.employeeId, employee.id), eq(employeeWorkplaces.isPrimary, true)));
    if (!primaryWorkplace) return { error: "Nemáš priradenú žiadnu prevádzku." };

    await tx.insert(absenceRequests).values({
      employeeId: employee.id,
      workplaceId: primaryWorkplace.workplaceId,
      kind,
      dateFrom,
      dateTo,
      isPartialDay,
      hours: isPartialDay ? hoursRaw : null,
      reason,
      status: "pending",
      requestedBy: user.id,
    });

    await notifyAbsenceRequestSubmitted(tx, {
      orgId: user.orgId,
      workplaceId: primaryWorkplace.workplaceId,
      employeeName: user.fullName,
      kindLabel: ABSENCE_KIND_CONFIG[kind].label,
      dateFrom,
      dateTo,
    });

    revalidatePath("/moje-ziadosti");
    return { success: true };
  });
}

/**
 * Bod 8 — zamestnanec smie zrušiť LEN nepotvrdenú (pending) žiadosť. RLS
 * (`req_update`) to aj tak vynúti (`employee_id = current_employee_id() AND
 * status = 'pending'`) — `where` s `eq(status,'pending')` tu je len pre
 * čitateľné "0 riadkov = nedalo sa" správanie, nie primárna obrana.
 */
export async function cancelAbsenceRequestAction(formData: FormData): Promise<void> {
  const user = await requireRole("employee");
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;

  await withUserContext(user.id, (tx) =>
    tx
      .update(absenceRequests)
      .set({ status: "cancelled" })
      .where(and(eq(absenceRequests.id, requestId), eq(absenceRequests.status, "pending"))),
  );

  revalidatePath("/moje-ziadosti");
}

"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { absenceRequests, employees } from "@/lib/db/schema";
import { ABSENCE_KIND_CONFIG, type AbsenceKind } from "@/components/calendar/absence-kinds";
import { notifyAbsenceRequestDecided } from "@/lib/notifications/events";

export type ActionState = { error?: string; success?: boolean };

/**
 * Bod 4 — schválenie. Materializácia do `absences`
 * (`is_confirmed=true`) ide cez DB trigger (migrácia 0016/0017), táto akcia
 * sa `absences` vôbec nedotýka priamo.
 */
export async function approveAbsenceRequestAction(formData: FormData): Promise<void> {
  const user = await requireRole("owner", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;

  await withUserContext(user.id, async (tx) => {
    const [req] = await tx
      .update(absenceRequests)
      .set({ status: "approved", decidedBy: user.id, decidedAt: new Date() })
      .where(eq(absenceRequests.id, requestId))
      .returning();
    if (!req) return;

    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId));
    if (employee?.userId) {
      await notifyAbsenceRequestDecided(tx, {
        employeeUserId: employee.userId,
        approved: true,
        kindLabel: ABSENCE_KIND_CONFIG[req.kind].label,
        dateFrom: req.dateFrom,
        dateTo: req.dateTo,
        decisionNote: null,
      });
    }
  });

  revalidatePath("/ziadosti");
  revalidatePath("/kalendar");
}

/**
 * Bod 4 — zamietnutie, **dôvod je povinný** (aj DB CHECK constraint
 * `absence_requests_rejection_note_check` to vynúti ako poslednú poistku —
 * tu je to len čitateľná chybová hláška namiesto surovej DB výnimky).
 */
export async function rejectAbsenceRequestAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  const decisionNote = String(formData.get("decisionNote") ?? "").trim();

  if (!requestId) return { error: "Chýba žiadosť." };
  if (!decisionNote) return { error: "Pri zamietnutí musíš uviesť dôvod." };

  await withUserContext(user.id, async (tx) => {
    const [req] = await tx
      .update(absenceRequests)
      .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date(), decisionNote })
      .where(eq(absenceRequests.id, requestId))
      .returning();
    if (!req) return;

    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId));
    if (employee?.userId) {
      await notifyAbsenceRequestDecided(tx, {
        employeeUserId: employee.userId,
        approved: false,
        kindLabel: ABSENCE_KIND_CONFIG[req.kind].label,
        dateFrom: req.dateFrom,
        dateTo: req.dateTo,
        decisionNote,
      });
    }
  });

  revalidatePath("/ziadosti");
  return { success: true };
}

/**
 * Bod 2 — manažér zadá žiadosť ZA zamestnanca (napr. PN prichádza spätne).
 * Rovno `status: "approved"` — manažér, ktorý ju zadáva, JE rozhodnutie
 * (žiadny zmysel v tom, aby čakala na schválenie sama sebou); trigger ju
 * materializuje priamo ako `is_confirmed=true`.
 */
export async function submitAbsenceOnBehalfAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("owner", "manager");

  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  const kind = String(formData.get("kind") ?? "") as AbsenceKind;
  const dateFrom = String(formData.get("dateFrom") ?? "");
  const dateTo = String(formData.get("dateTo") ?? "") || dateFrom;
  const isPartialDay = formData.get("isPartialDay") === "true";
  const hoursRaw = String(formData.get("hours") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!employeeId || !workplaceId || !kind || !dateFrom) return { error: "Vyplň zamestnanca, druh a dátum." };
  if (dateTo < dateFrom) return { error: "Dátum 'do' musí byť rovnaký alebo neskorší než 'od'." };
  if (isPartialDay && (!hoursRaw || Number(hoursRaw) <= 0)) return { error: "Pri neprítomnosti na hodiny zadaj kladný počet hodín." };

  await withUserContext(user.id, (tx) =>
    tx.insert(absenceRequests).values({
      employeeId,
      workplaceId,
      kind,
      dateFrom,
      dateTo,
      isPartialDay,
      hours: isPartialDay ? hoursRaw : null,
      reason,
      status: "approved",
      requestedBy: user.id,
      decidedBy: user.id,
      decidedAt: new Date(),
    }),
  );

  revalidatePath("/ziadosti");
  revalidatePath("/kalendar");
  return { success: true };
}

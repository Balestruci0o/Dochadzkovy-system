"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { attendanceDays, employeeWorkplaces, employees, missingPunchRequests, punchCorrectionRequests } from "@/lib/db/schema";
import { notifyMissingPunchRequested, notifyPunchCorrectionRequested } from "@/lib/notifications/events";
import type { PunchKind } from "@/lib/punch/qr-token";
import { todayStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";

export type ActionState = { error?: string; success?: boolean };

/**
 * Prvý krok — zamestnanec požiada o presun času. Pôvodné
 * razítko sa nedotkne (append-only) — toto je len ŽIADOSŤ, manažér ju musí
 * schváliť (`/dnes`), až vtedy vznikne opravná udalosť.
 */
export async function requestCorrectionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("employee");

  const attendanceDayId = String(formData.get("attendanceDayId") ?? "");
  const requestedStartRaw = String(formData.get("requestedStart") ?? "").trim();
  const requestedEndRaw = String(formData.get("requestedEnd") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!attendanceDayId) return { error: "Chýba deň, ktorého sa žiadosť týka." };
  if (!reason) return { error: "Vysvetli, prečo o opravu žiadaš." };
  if (!requestedStartRaw && !requestedEndRaw) return { error: "Zadaj aspoň jeden opravený čas (príchod alebo odchod)." };

  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id));
    if (!employee) return { error: "K tomuto účtu nie je priradený žiadny zamestnanec." };

    const [day] = await tx.select().from(attendanceDays).where(eq(attendanceDays.id, attendanceDayId));
    if (!day || day.employeeId !== employee.id) return { error: "Deň nenájdený." };

    await tx.insert(punchCorrectionRequests).values({
      employeeId: employee.id,
      attendanceDayId,
      requestedStart: requestedStartRaw ? zonedTimeToUtc(day.date, `${requestedStartRaw}:00`) : null,
      requestedEnd: requestedEndRaw ? zonedTimeToUtc(day.date, `${requestedEndRaw}:00`) : null,
      reason,
    });

    await notifyPunchCorrectionRequested(tx, { orgId: user.orgId, workplaceId: day.workplaceId, employeeName: user.fullName, date: day.date });

    revalidatePath("/moja-dochadzka");
    return { success: true };
  });
}

/**
 * "Chýba mi pípnutie" — na rozdiel od `requestCorrectionAction` (opravuje
 * EXISTUJÚCI deň) toto rieši úplne VYNECHANÝ deň (terminál nešiel, appka
 * spadla) — žiadny `punch_events` ani `attendance_days` riadok nemusí ešte
 * vôbec existovať, takže sa neviaže na `attendanceDayId`, len na
 * employeeId+workplaceId+date. Manažér/owner schváli na `/dnes`.
 */
export async function requestMissingPunchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireRole("employee");

  const workplaceId = String(formData.get("workplaceId") ?? "");
  const date = String(formData.get("date") ?? "").trim();
  const direction = formData.get("direction") === "out" ? "out" : "in";
  const kind: PunchKind = formData.get("kind") === "prestavka" ? "prestavka" : "zmena";
  const timeRaw = String(formData.get("time") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!workplaceId) return { error: "Vyber prevádzku." };
  if (!date) return { error: "Vyber dátum." };
  if (date > todayStr()) return { error: "Dátum nemôže byť v budúcnosti." };
  if (!timeRaw) return { error: "Zadaj čas." };
  if (!reason) return { error: "Vysvetli, čo sa stalo (napr. nefunkčný terminál)." };

  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id));
    if (!employee) return { error: "K tomuto účtu nie je priradený žiadny zamestnanec." };

    const [membership] = await tx
      .select({ workplaceId: employeeWorkplaces.workplaceId })
      .from(employeeWorkplaces)
      .where(and(eq(employeeWorkplaces.employeeId, employee.id), eq(employeeWorkplaces.workplaceId, workplaceId)));
    if (!membership) return { error: "Nie si priradený/á k tejto prevádzke." };

    await tx.insert(missingPunchRequests).values({
      employeeId: employee.id,
      workplaceId,
      date,
      direction,
      kind,
      requestedTime: zonedTimeToUtc(date, `${timeRaw}:00`),
      reason,
    });

    await notifyMissingPunchRequested(tx, { orgId: user.orgId, workplaceId, employeeName: user.fullName, date });

    revalidatePath("/moja-dochadzka");
    return { success: true };
  });
}

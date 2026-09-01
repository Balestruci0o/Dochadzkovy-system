"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
// eslint-disable-next-line no-restricted-imports -- zápis do punch_events ide vždy cez service role (schema.sql: "zápis ide cez service role, nie cez klienta"); autorizácia manažéra je overená vyššie cez RLS-scoped čítanie žiadosti (punch_correction_requests_select)
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employees, missingPunchRequests, punchCorrectionRequests, punchEvents } from "@/lib/db/schema";
import { eventsForLocalDate, recomputeAttendanceDay } from "@/lib/punch/attendance";
import { notifyMissingPunchResolved, notifyPunchCorrectionResolved } from "@/lib/notifications/events";
import { finalizeAttendanceCorrection, setAuditActor } from "@/lib/punch/manual-correction";
import { getOnBreakNow, type OnBreakNow } from "./data";

/** Klient (`OnBreakNowCard`) si stav sám dopolluje — rovnaký vzor ako `getMyNotifications`. */
export async function getOnBreakNowAction(): Promise<OnBreakNow[]> {
  const user = await requireRole("owner", "manager");
  return getOnBreakNow(user);
}

/**
 * Druhý krok — manažér schváli žiadosť o opravu. Vytvorí NOVÚ
 * opravnú udalosť (`corrects_event_id` na pôvodnú, ešte nenahradenú udalosť
 * toho smeru) — pôvodná v `punch_events` ZOSTÁVA, nikdy sa needituje.
 */
export async function approveCorrectionAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;

  // RLS-scoped čítanie — manažér uvidí len žiadosti vo svojich prevádzkach
  // (punch_correction_requests_select). Toto je skutočná autorizačná brána.
  const request = await withUserContext(user.id, async (tx) => {
    const [r] = await tx.select().from(punchCorrectionRequests).where(eq(punchCorrectionRequests.id, requestId));
    return r && r.status === "pending" ? r : null;
  });
  if (!request) return;

  await adminDb.transaction(async (tx) => {
    // adminDb (service role) nikdy nenastavuje app.user_id — bez tohto by
    // audit_log (audit_attendance, audit_punch_events) zapísal changed_by=NULL
    // aj pre túto manažérom vyvolanú opravu. Len na AUDIT, nie na RLS (tá sa na
    // tomto pripojení aj tak nevyhodnocuje).
    await tx.execute(sql`SELECT set_config('app.user_id', ${user.id}, true)`);

    const [day] = await tx.select().from(attendanceDays).where(eq(attendanceDays.id, request.attendanceDayId));
    if (!day) return;

    const activeEvents = await eventsForLocalDate(tx, day.employeeId, day.workplaceId, day.date);
    const originalIn = activeEvents.find((e) => e.direction === "in");
    const originalOut = [...activeEvents].reverse().find((e) => e.direction === "out");

    if (request.requestedStart) {
      await tx.insert(punchEvents).values({
        employeeId: day.employeeId,
        workplaceId: day.workplaceId,
        direction: "in",
        method: "manual",
        occurredAt: request.requestedStart,
        correctsEventId: originalIn?.id ?? null,
        correctionReason: request.reason,
        createdBy: user.id,
      });
    }
    if (request.requestedEnd) {
      await tx.insert(punchEvents).values({
        employeeId: day.employeeId,
        workplaceId: day.workplaceId,
        direction: "out",
        method: "manual",
        occurredAt: request.requestedEnd,
        correctsEventId: originalOut?.id ?? null,
        correctionReason: request.reason,
        createdBy: user.id,
      });
    }

    await recomputeAttendanceDay(tx, day.employeeId, day.workplaceId, day.date);
    await tx
      .update(attendanceDays)
      .set({ isCorrected: true, correctedBy: user.id, correctedAt: new Date(), correctionNote: request.reason })
      .where(eq(attendanceDays.id, day.id));

    await tx
      .update(punchCorrectionRequests)
      .set({ status: "approved", decidedBy: user.id, decidedAt: new Date() })
      .where(eq(punchCorrectionRequests.id, requestId));

    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, day.employeeId));
    if (employee?.userId) {
      await notifyPunchCorrectionResolved(tx, { employeeUserId: employee.userId, approved: true, date: day.date });
    }
  });

  revalidatePath("/dnes");
}

export async function rejectCorrectionAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  const decisionNote = String(formData.get("decisionNote") ?? "").trim() || null;
  if (!requestId) return;

  await withUserContext(user.id, async (tx) => {
    const [req] = await tx
      .update(punchCorrectionRequests)
      .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date(), decisionNote })
      .where(eq(punchCorrectionRequests.id, requestId))
      .returning();
    if (!req) return;

    const [context] = await tx
      .select({ userId: employees.userId, date: attendanceDays.date })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .where(eq(attendanceDays.id, req.attendanceDayId));
    if (context?.userId) {
      await notifyPunchCorrectionResolved(tx, { employeeUserId: context.userId, approved: false, date: context.date });
    }
  });

  revalidatePath("/dnes");
}

/**
 * "Chýba mi pípnutie" — schválenie zamestnancovej žiadosti. Na rozdiel od
 * `approveCorrectionAction` (opravuje EXISTUJÚCE pípnutie, `correctsEventId`
 * na pôvodnú udalosť) toto vkladá ÚPLNE NOVÚ udalosť bez väzby na nič — deň
 * bol predtým celý vynechaný (`attendance_days` riadok nemusel existovať,
 * `finalizeAttendanceCorrection` ho vytvorí cez `recomputeAttendanceDay`).
 */
export async function approveMissingPunchAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  if (!requestId) return;

  // RLS-scoped čítanie — manažér uvidí len žiadosti vo svojich prevádzkach
  // (missing_punch_requests_select). Toto je skutočná autorizačná brána.
  const request = await withUserContext(user.id, async (tx) => {
    const [r] = await tx.select().from(missingPunchRequests).where(eq(missingPunchRequests.id, requestId));
    return r && r.status === "pending" ? r : null;
  });
  if (!request) return;

  await adminDb.transaction(async (tx) => {
    await setAuditActor(tx, user.id);

    await tx.insert(punchEvents).values({
      employeeId: request.employeeId,
      workplaceId: request.workplaceId,
      direction: request.direction,
      kind: request.kind,
      method: "manual",
      occurredAt: request.requestedTime,
      correctionReason: request.reason,
      createdBy: user.id,
    });

    await finalizeAttendanceCorrection(
      tx,
      { employeeId: request.employeeId, workplaceId: request.workplaceId, date: request.date },
      user.id,
      request.reason,
    );

    await tx
      .update(missingPunchRequests)
      .set({ status: "approved", decidedBy: user.id, decidedAt: new Date() })
      .where(eq(missingPunchRequests.id, requestId));

    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, request.employeeId));
    if (employee?.userId) {
      await notifyMissingPunchResolved(tx, { employeeUserId: employee.userId, approved: true, date: request.date });
    }
  });

  revalidatePath("/dnes");
}

export async function rejectMissingPunchAction(formData: FormData) {
  const user = await requireRole("owner", "manager");
  const requestId = String(formData.get("requestId") ?? "");
  const decisionNote = String(formData.get("decisionNote") ?? "").trim() || null;
  if (!requestId) return;

  await withUserContext(user.id, async (tx) => {
    const [req] = await tx
      .update(missingPunchRequests)
      .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date(), decisionNote })
      .where(eq(missingPunchRequests.id, requestId))
      .returning();
    if (!req) return;

    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, req.employeeId));
    if (employee?.userId) {
      await notifyMissingPunchResolved(tx, { employeeUserId: employee.userId, approved: false, date: req.date });
    }
  });

  revalidatePath("/dnes");
}

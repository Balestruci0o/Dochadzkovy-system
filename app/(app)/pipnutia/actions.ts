"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
// eslint-disable-next-line no-restricted-imports -- zápis do punch_events ide vždy cez service role (schema.sql), rovnaká výnimka ako app/(app)/dnes/actions.ts#approveCorrectionAction
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employeePositionHistory, employeeWorkplaces, employees, positions, punchEvents } from "@/lib/db/schema";
import { notifyPunchCorrectedByManager } from "@/lib/notifications/events";
import type { PunchKind } from "@/lib/punch/qr-token";
import { eventsForLocalDate } from "@/lib/punch/attendance";
import { finalizeAttendanceCorrection, setAuditActor } from "@/lib/punch/manual-correction";
import { resolveBreakTrackingMode } from "@/lib/scheduler/break-tracking-mode";
import { todayStr } from "@/lib/shared/dates";
import { zonedTimeToUtc } from "@/lib/shared/time";

export type DirectCorrectionState = { error?: string; success?: boolean };

type AttendanceDay = typeof attendanceDays.$inferSelect;

/**
 * RLS-scoped čítanie cieľového dňa — SKUTOČNÁ autorizačná brána (att_select:
 * accessible_workplaces()) pre všetky akcie v tomto súbore. Bez nej by
 * manažér z inej prevádzky/org mohol adminDb obísť RLS úplne. `att_write`
 * navyše vyžaduje `is_locked = false`, čo sa na adminDb nevyhodnocuje —
 * treba to overiť explicitne tu.
 */
async function loadEditableDay(userId: string, attendanceDayId: string): Promise<AttendanceDay | { error: string }> {
  const day = await withUserContext(userId, async (tx) => {
    const [d] = await tx.select().from(attendanceDays).where(eq(attendanceDays.id, attendanceDayId));
    return d ?? null;
  });
  if (!day) return { error: "Deň nenájdený alebo nemáš prístup k tejto prevádzke." };
  if (day.isLocked) return { error: "Tento deň je uzamknutý (uzavreté obdobie) — nedá sa opraviť." };
  return day;
}

/**
 * Cieľová udalosť pre granulárnu opravu (jedno pípnutie) — MUSÍ patriť
 * TOMUTO zamestnancovi/prevádzke (obrana proti podvrhnutému eventId z inej
 * organizácie) a NESMIE byť už anulovaná/nahradená (idempotencia — zabráni
 * dvojitej oprave zo zastaranej klientskej UI).
 */
async function loadEditableEvent(
  day: AttendanceDay,
  eventId: number,
): Promise<{ id: number; direction: "in" | "out"; kind: PunchKind; occurredAt: Date } | { error: string }> {
  const [target] = await adminDb.select().from(punchEvents).where(eq(punchEvents.id, eventId));
  if (!target || target.employeeId !== day.employeeId || target.workplaceId !== day.workplaceId) {
    return { error: "Pípnutie nenájdené." };
  }
  if (target.isVoid) {
    return { error: "Toto pípnutie už bolo zmazané." };
  }
  const [supersededBy] = await adminDb.select({ id: punchEvents.id }).from(punchEvents).where(eq(punchEvents.correctsEventId, eventId));
  if (supersededBy) {
    return { error: "Toto pípnutie už bolo upravené — obnov stránku a skús znova z aktuálneho zoznamu." };
  }
  return { id: target.id, direction: target.direction, kind: target.kind, occurredAt: target.occurredAt };
}

/**
 * Rozšírenie — manažér/owner opraví príchod/odchod/prestávku
 * PRIAMO, bez žiadosti zamestnanca a bez schvaľovania (na rozdiel od
 * `dnes/actions.ts#approveCorrectionAction`, ktorá schvaľuje CUDZIU žiadosť).
 * Rovnaký append-only mechanizmus: NOVÁ opravná
 * `punch_events` udalosť s `corrects_event_id`, pôvodná zostáva navždy.
 */
export async function directCorrectPunchAction(
  _prev: DirectCorrectionState,
  formData: FormData,
): Promise<DirectCorrectionState> {
  const user = await requireRole("owner", "manager");
  const attendanceDayId = String(formData.get("attendanceDayId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!attendanceDayId) return { error: "Chýba ID dňa." };
  if (!reason) return { error: "Vyplň dôvod opravy." };

  const requestedStartRaw = String(formData.get("requestedStart") ?? "").trim();
  const requestedEndRaw = String(formData.get("requestedEnd") ?? "").trim();
  const requestedBreakStartRaw = String(formData.get("requestedBreakStart") ?? "").trim();
  const requestedBreakEndRaw = String(formData.get("requestedBreakEnd") ?? "").trim();

  const day = await loadEditableDay(user.id, attendanceDayId);
  if ("error" in day) return day;

  const requestedStart = requestedStartRaw ? zonedTimeToUtc(day.date, `${requestedStartRaw}:00`) : null;
  const requestedEnd = requestedEndRaw ? zonedTimeToUtc(day.date, `${requestedEndRaw}:00`) : null;
  const requestedBreakStart = requestedBreakStartRaw ? zonedTimeToUtc(day.date, `${requestedBreakStartRaw}:00`) : null;
  const requestedBreakEnd = requestedBreakEndRaw ? zonedTimeToUtc(day.date, `${requestedBreakEndRaw}:00`) : null;

  if (!requestedStart && !requestedEnd && !requestedBreakStart && !requestedBreakEnd) {
    return { error: "Vyplň aspoň jeden čas na opravu." };
  }

  if (requestedBreakStart || requestedBreakEnd) {
    const canCorrectBreak = await canCorrectBreakFor(user.id, day.employeeId);
    if (!canCorrectBreak) {
      return {
        error: "Táto pozícia neeviduje prestávky pípnutím — čas prestávky sa počíta automaticky zo šablóny, nedá sa takto opraviť.",
      };
    }
  }

  await adminDb.transaction(async (tx) => {
    await setAuditActor(tx, user.id);

    if (requestedStart || requestedEnd) {
      const activeEvents = await eventsForLocalDate(tx, day.employeeId, day.workplaceId, day.date, "zmena");
      const originalIn = activeEvents.find((e) => e.direction === "in");
      const originalOut = [...activeEvents].reverse().find((e) => e.direction === "out");

      if (requestedStart) {
        await tx.insert(punchEvents).values({
          employeeId: day.employeeId,
          workplaceId: day.workplaceId,
          direction: "in",
          kind: "zmena",
          method: "manual",
          occurredAt: requestedStart,
          correctsEventId: originalIn?.id ?? null,
          correctionReason: reason,
          createdBy: user.id,
        });
      }
      if (requestedEnd) {
        await tx.insert(punchEvents).values({
          employeeId: day.employeeId,
          workplaceId: day.workplaceId,
          direction: "out",
          kind: "zmena",
          method: "manual",
          occurredAt: requestedEnd,
          correctsEventId: originalOut?.id ?? null,
          correctionReason: reason,
          createdBy: user.id,
        });
      }
    }

    if (requestedBreakStart || requestedBreakEnd) {
      // Prestávky striedajú out/in (odchod→návrat) — cieľom opravy je VŽDY
      // POSLEDNÝ pár dňa: posledné 'out' a prvé 'in' PO ňom (nie prvé 'in'
      // dňa celkovo — to by pri viacerých prestávkach trafilo iný pár).
      const breakEvents = await eventsForLocalDate(tx, day.employeeId, day.workplaceId, day.date, "prestavka");
      const originalBreakOut = [...breakEvents].reverse().find((e) => e.direction === "out");
      const originalBreakIn = originalBreakOut
        ? breakEvents.find((e) => e.direction === "in" && e.occurredAt.getTime() > originalBreakOut.occurredAt.getTime())
        : breakEvents.find((e) => e.direction === "in");

      if (requestedBreakStart) {
        await tx.insert(punchEvents).values({
          employeeId: day.employeeId,
          workplaceId: day.workplaceId,
          direction: "out",
          kind: "prestavka",
          method: "manual",
          occurredAt: requestedBreakStart,
          correctsEventId: originalBreakOut?.id ?? null,
          correctionReason: reason,
          createdBy: user.id,
        });
      }
      if (requestedBreakEnd) {
        await tx.insert(punchEvents).values({
          employeeId: day.employeeId,
          workplaceId: day.workplaceId,
          direction: "in",
          kind: "prestavka",
          method: "manual",
          occurredAt: requestedBreakEnd,
          correctsEventId: originalBreakIn?.id ?? null,
          correctionReason: reason,
          createdBy: user.id,
        });
      }
    }

    await finalizeAttendanceCorrection(tx, day, user.id, reason);
    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, day.employeeId));
    if (employee?.userId) {
      await notifyPunchCorrectedByManager(tx, { employeeUserId: employee.userId, date: day.date });
    }
  });

  revalidatePath("/pipnutia");
  return { success: true };
}

async function canCorrectBreakFor(userId: string, employeeId: string): Promise<boolean> {
  return withUserContext(userId, async (tx) => {
    const [currentPosition] = await tx
      .select({ breakTrackingMode: positions.breakTrackingMode })
      .from(employeePositionHistory)
      .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
      .where(and(eq(employeePositionHistory.employeeId, employeeId), isNull(employeePositionHistory.validTo)));
    const [emp] = await tx
      .select({ overrideBreakTrackingMode: employees.overrideBreakTrackingMode })
      .from(employees)
      .where(eq(employees.id, employeeId));
    return (
      resolveBreakTrackingMode(currentPosition ?? null, {
        overrideBreakTrackingMode: emp?.overrideBreakTrackingMode ?? null,
      }) === "pipa"
    );
  });
}

/**
 * Granulárna oprava JEDNÉHO pípnutia — čas, smer AJ typ (prestávka ↔
 * príchod/odchod) naraz, nie len deň ako celok (`directCorrectPunchAction`).
 * Append-only: VŽDY vloží NOVÚ udalosť s `correctsEventId` na pôvodnú.
 *
 * Keď sa MENÍ `kind` (napr. omylom napípnuté ako "prestavka" namiesto
 * "zmena"), jedna korektívna udalosť NESTAČÍ — `eventsForLocalDate` číta
 * VÝHRADNE udalosti ROVNAKÉHO kind (`eq(punchEvents.kind, kind)` v SQL), takže
 * náhrada v INOM kind by dopyt na PÔVODNÝ kind nikdy neuvidel a pôvodná
 * udalosť by ostala mylne "aktívna". Preto: pri zmene kind sa pôvodná
 * VÝSLOVNE anuluje (is_void=true, rovnaký kind ako ona) A SAMOSTATNE sa
 * vloží nová udalosť v novom kind bez väzby na pôvodnú (nekoriguje ju v
 * rámci jej kind, je to nový, iný druh udalosti). Keď sa kind NEMENÍ, jedna
 * bežná korekcia (rovnaký vzor ako `directCorrectPunchAction`) stačí.
 */
export async function editPunchEventAction(
  _prev: DirectCorrectionState,
  formData: FormData,
): Promise<DirectCorrectionState> {
  const user = await requireRole("owner", "manager");
  const attendanceDayId = String(formData.get("attendanceDayId") ?? "");
  const eventId = Number(formData.get("eventId"));
  const newDirection = formData.get("newDirection") === "out" ? "out" : "in";
  const newKind: PunchKind = formData.get("newKind") === "prestavka" ? "prestavka" : "zmena";
  const newTimeRaw = String(formData.get("newTime") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!attendanceDayId || !eventId) return { error: "Chýba ID dňa alebo pípnutia." };
  if (!newTimeRaw) return { error: "Vyplň nový čas." };
  if (!reason) return { error: "Vyplň dôvod opravy." };

  const day = await loadEditableDay(user.id, attendanceDayId);
  if ("error" in day) return day;

  const original = await loadEditableEvent(day, eventId);
  if ("error" in original) return original;

  if (newKind === "prestavka" && !(await canCorrectBreakFor(user.id, day.employeeId))) {
    return {
      error: "Táto pozícia neeviduje prestávky pípnutím — čas prestávky sa počíta automaticky zo šablóny, nedá sa takto opraviť.",
    };
  }

  const newOccurredAt = zonedTimeToUtc(day.date, `${newTimeRaw}:00`);
  const kindChanged = newKind !== original.kind;

  if (!kindChanged && newDirection === original.direction && newOccurredAt.getTime() === original.occurredAt.getTime()) {
    return { error: "Nič sa nezmenilo." };
  }

  await adminDb.transaction(async (tx) => {
    await setAuditActor(tx, user.id);

    if (kindChanged) {
      // Anuluj pôvodnú (v JEJ PÔVODNOM kind, inak by ju dopyt na ten istý kind
      // nikdy neoznačil za nahradenú) a vlož novú ako samostatnú udalosť.
      await tx.insert(punchEvents).values({
        employeeId: day.employeeId,
        workplaceId: day.workplaceId,
        direction: original.direction,
        kind: original.kind,
        method: "manual",
        occurredAt: original.occurredAt,
        correctsEventId: original.id,
        isVoid: true,
        correctionReason: reason,
        createdBy: user.id,
      });
      await tx.insert(punchEvents).values({
        employeeId: day.employeeId,
        workplaceId: day.workplaceId,
        direction: newDirection,
        kind: newKind,
        method: "manual",
        occurredAt: newOccurredAt,
        correctionReason: reason,
        createdBy: user.id,
      });
    } else {
      await tx.insert(punchEvents).values({
        employeeId: day.employeeId,
        workplaceId: day.workplaceId,
        direction: newDirection,
        kind: newKind,
        method: "manual",
        occurredAt: newOccurredAt,
        correctsEventId: original.id,
        correctionReason: reason,
        createdBy: user.id,
      });
    }

    await finalizeAttendanceCorrection(tx, day, user.id, reason);
    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, day.employeeId));
    if (employee?.userId) {
      await notifyPunchCorrectedByManager(tx, { employeeUserId: employee.userId, date: day.date });
    }
  });

  revalidatePath("/pipnutia");
  return { success: true };
}

/**
 * Zmaže JEDNO pípnutie (napr. omylom vytvorené duplicitné razítko) — append-only:
 * NEMAŽE riadok, vloží anulačnú udalosť (`is_void=true`, `correctsEventId`
 * na pôvodnú) BEZ náhrady. `eventsForLocalDate` obe (pôvodnú aj anulačnú)
 * navždy vynechá z výpočtu.
 */
export async function deletePunchEventAction(
  _prev: DirectCorrectionState,
  formData: FormData,
): Promise<DirectCorrectionState> {
  const user = await requireRole("owner", "manager");
  const attendanceDayId = String(formData.get("attendanceDayId") ?? "");
  const eventId = Number(formData.get("eventId"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!attendanceDayId || !eventId) return { error: "Chýba ID dňa alebo pípnutia." };
  if (!reason) return { error: "Vyplň dôvod zmazania." };

  const day = await loadEditableDay(user.id, attendanceDayId);
  if ("error" in day) return day;

  const original = await loadEditableEvent(day, eventId);
  if ("error" in original) return original;

  await adminDb.transaction(async (tx) => {
    await setAuditActor(tx, user.id);

    await tx.insert(punchEvents).values({
      employeeId: day.employeeId,
      workplaceId: day.workplaceId,
      direction: original.direction,
      kind: original.kind,
      method: "manual",
      occurredAt: original.occurredAt,
      correctsEventId: original.id,
      isVoid: true,
      correctionReason: reason,
      createdBy: user.id,
    });

    await finalizeAttendanceCorrection(tx, day, user.id, reason);
    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, day.employeeId));
    if (employee?.userId) {
      await notifyPunchCorrectedByManager(tx, { employeeUserId: employee.userId, date: day.date });
    }
  });

  revalidatePath("/pipnutia");
  return { success: true };
}

/**
 * "Chýba mi pípnutie", manažérska strana — manažér/owner PRIDÁ pípnutie
 * PRIAMO komukoľvek, kto sa nepípol, BEZ žiadosti (na rozdiel od
 * `dnes/actions.ts#approveMissingPunchAction`, ktorá schvaľuje CUDZIU
 * žiadosť). Na rozdiel od `directCorrectPunchAction`/`editPunchEventAction`
 * NEBERIE `attendanceDayId` — pre úplne vynechaný deň žiadny `attendance_days`
 * riadok ešte nemusí existovať (`finalizeAttendanceCorrection` ho vytvorí).
 */
export async function addMissingPunchAction(
  _prev: DirectCorrectionState,
  formData: FormData,
): Promise<DirectCorrectionState> {
  const user = await requireRole("owner", "manager");
  const employeeId = String(formData.get("employeeId") ?? "");
  const workplaceId = String(formData.get("workplaceId") ?? "");
  const date = String(formData.get("date") ?? "").trim();
  const direction = formData.get("direction") === "out" ? "out" : "in";
  const kind: PunchKind = formData.get("kind") === "prestavka" ? "prestavka" : "zmena";
  const timeRaw = String(formData.get("time") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();

  if (!employeeId || !workplaceId) return { error: "Vyber zamestnanca a prevádzku." };
  if (!date) return { error: "Vyber dátum." };
  if (date > todayStr()) return { error: "Dátum nemôže byť v budúcnosti." };
  if (!timeRaw) return { error: "Zadaj čas." };
  if (!reason) return { error: "Vyplň dôvod." };

  // RLS-scoped čítanie — SKUTOČNÁ autorizačná brána: zamestnanec musí patriť
  // k prevádzke, ku ktorej má TENTO manažér prístup (accessible_workplaces()).
  const membership = await withUserContext(user.id, async (tx) => {
    const [m] = await tx
      .select({ employeeId: employeeWorkplaces.employeeId })
      .from(employeeWorkplaces)
      .where(and(eq(employeeWorkplaces.employeeId, employeeId), eq(employeeWorkplaces.workplaceId, workplaceId)));
    return m ?? null;
  });
  if (!membership) return { error: "Zamestnanec nenájdený alebo nemáš prístup k tejto prevádzke." };

  if (kind === "prestavka" && !(await canCorrectBreakFor(user.id, employeeId))) {
    return {
      error: "Táto pozícia neeviduje prestávky pípnutím — čas prestávky sa počíta automaticky zo šablóny, nedá sa takto pridať.",
    };
  }

  // Ak pre tento deň už attendance_days existuje (napr. iné pípnutie ten deň
  // už bolo), over is_locked — rovnaká ochrana ako `loadEditableDay`. Ak
  // ešte neexistuje (typický prípad — celý deň vynechaný), niet čo uzamknúť.
  const existingDay = await withUserContext(user.id, async (tx) => {
    const [d] = await tx
      .select({ isLocked: attendanceDays.isLocked })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.workplaceId, workplaceId), eq(attendanceDays.date, date)));
    return d ?? null;
  });
  if (existingDay?.isLocked) return { error: "Tento deň je uzamknutý (uzavreté obdobie) — nedá sa opraviť." };

  const requestedTime = zonedTimeToUtc(date, `${timeRaw}:00`);

  await adminDb.transaction(async (tx) => {
    await setAuditActor(tx, user.id);

    await tx.insert(punchEvents).values({
      employeeId,
      workplaceId,
      direction,
      kind,
      method: "manual",
      occurredAt: requestedTime,
      correctionReason: reason,
      createdBy: user.id,
    });

    await finalizeAttendanceCorrection(tx, { employeeId, workplaceId, date }, user.id, reason);
    const [employee] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, employeeId));
    if (employee?.userId) {
      await notifyPunchCorrectedByManager(tx, { employeeUserId: employee.userId, date });
    }
  });

  revalidatePath("/pipnutia");
  return { success: true };
}

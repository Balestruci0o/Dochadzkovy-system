import { and, eq } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { attendanceDays, employees, missingPunchRequests, punchCorrectionRequests, workplaces } from "@/lib/db/schema";
import { eventsForLocalDate } from "@/lib/punch/attendance";
import { localDateStr } from "@/lib/shared/time";

export type PendingCorrection = {
  id: string;
  employeeName: string;
  workplaceName: string;
  date: string;
  requestedStart: Date | null;
  requestedEnd: Date | null;
  reason: string;
  createdAt: Date;
};

/** RLS (`punch_correction_requests_select`) už obmedzí na prevádzky, ku ktorým má manažér/owner prístup. */
export async function getPendingCorrections(user: CurrentUser): Promise<PendingCorrection[]> {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({
        id: punchCorrectionRequests.id,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        workplaceName: workplaces.name,
        date: attendanceDays.date,
        requestedStart: punchCorrectionRequests.requestedStart,
        requestedEnd: punchCorrectionRequests.requestedEnd,
        reason: punchCorrectionRequests.reason,
        createdAt: punchCorrectionRequests.createdAt,
      })
      .from(punchCorrectionRequests)
      .innerJoin(attendanceDays, eq(attendanceDays.id, punchCorrectionRequests.attendanceDayId))
      .innerJoin(employees, eq(employees.id, punchCorrectionRequests.employeeId))
      .innerJoin(workplaces, eq(workplaces.id, attendanceDays.workplaceId))
      .where(eq(punchCorrectionRequests.status, "pending"))
      .orderBy(punchCorrectionRequests.createdAt);

    return rows.map((r) => ({
      id: r.id,
      employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
      workplaceName: r.workplaceName,
      date: r.date,
      requestedStart: r.requestedStart,
      requestedEnd: r.requestedEnd,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  });
}

export type PendingMissingPunch = {
  id: string;
  employeeName: string;
  workplaceName: string;
  date: string;
  direction: "in" | "out";
  kind: "zmena" | "prestavka";
  requestedTime: Date;
  reason: string;
  createdAt: Date;
};

/**
 * "Chýba mi pípnutie" žiadosti čakajúce na schválenie — RLS
 * (`missing_punch_requests_select`) už obmedzí na prevádzky, ku ktorým má
 * manažér/owner prístup, rovnako ako `getPendingCorrections`.
 */
export async function getPendingMissingPunchRequests(user: CurrentUser): Promise<PendingMissingPunch[]> {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({
        id: missingPunchRequests.id,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        workplaceName: workplaces.name,
        date: missingPunchRequests.date,
        direction: missingPunchRequests.direction,
        kind: missingPunchRequests.kind,
        requestedTime: missingPunchRequests.requestedTime,
        reason: missingPunchRequests.reason,
        createdAt: missingPunchRequests.createdAt,
      })
      .from(missingPunchRequests)
      .innerJoin(employees, eq(employees.id, missingPunchRequests.employeeId))
      .innerJoin(workplaces, eq(workplaces.id, missingPunchRequests.workplaceId))
      .where(eq(missingPunchRequests.status, "pending"))
      .orderBy(missingPunchRequests.createdAt);

    return rows.map((r) => ({
      id: r.id,
      employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
      workplaceName: r.workplaceName,
      date: r.date,
      direction: r.direction,
      kind: r.kind,
      requestedTime: r.requestedTime,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  });
}

export type OnBreakNow = {
  employeeId: string;
  employeeName: string;
  workplaceName: string;
  breakStartedAt: Date;
};

/**
 * Kto je PRÁVE TERAZ na prestávke — posledné dnešné 'prestavka' razítko je
 * 'out' (odišiel, ešte sa nevrátil). RLS (`att_select`) už obmedzí kandidátov
 * na prevádzky, ku ktorým má manažér/owner prístup — netreba duplicitný
 * `accessible_workplaces()` filter ako pri `workplaces`-tabuľkových dopytoch.
 *
 * Kandidátov (dnešné `status = 'working'` dni) je v praxi málo — preto sa
 * pre každého jednotlivo pýta `eventsForLocalDate` (rovnaká, už otestovaná
 * dedup logika ako `determineDirection`/`auto-close`), namiesto duplikovania
 * jej "posledná neopravaná udalosť dňa" logiky v jednom veľkom SQL dopyte.
 */
export async function getOnBreakNow(user: CurrentUser): Promise<OnBreakNow[]> {
  return withUserContext(user.id, async (tx) => {
    const today = localDateStr(new Date());

    const working = await tx
      .select({
        employeeId: attendanceDays.employeeId,
        workplaceId: attendanceDays.workplaceId,
        workplaceName: workplaces.name,
        firstName: employees.firstName,
        lastName: employees.lastName,
      })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .innerJoin(workplaces, eq(workplaces.id, attendanceDays.workplaceId))
      .where(and(eq(attendanceDays.status, "working"), eq(attendanceDays.date, today)));

    const result: OnBreakNow[] = [];
    for (const w of working) {
      const lastBreak = (await eventsForLocalDate(tx, w.employeeId, w.workplaceId, today, "prestavka")).at(-1);
      if (lastBreak?.direction === "out") {
        result.push({
          employeeId: w.employeeId,
          employeeName: `${w.firstName} ${w.lastName}`,
          workplaceName: w.workplaceName,
          breakStartedAt: lastBreak.occurredAt,
        });
      }
    }

    return result.sort((a, b) => a.breakStartedAt.getTime() - b.breakStartedAt.getTime());
  });
}

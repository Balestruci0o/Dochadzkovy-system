import { and, desc, eq, gte, isNull } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  attendanceDays,
  employeePositionHistory,
  employeeWorkplaces,
  employees,
  missingPunchRequests,
  positions,
  punchCorrectionRequests,
  workplaces,
} from "@/lib/db/schema";
import { determineDirection, eventsForLocalDate } from "@/lib/punch/attendance";
import { liveWorkedHours } from "@/lib/punch/live-worked-hours";
import { resolveBreakTrackingMode } from "@/lib/scheduler/break-tracking-mode";
import { localDateStr } from "@/lib/shared/time";

export type MyAttendance = {
  employeeId: string;
  canPunchWeb: boolean;
  canPunchBreaks: boolean;
  workplaces: { workplaceId: string; workplaceName: string; isPrimary: boolean }[];
  /** Ktorý smer by TERAZ zapísalo pípnutie z webu pre danú prevádzku — LEN na
   * popisok tlačidla (rovnaká `determineDirection` ako pri reálnom zápise,
   * viď `app/api/punch/web/route.ts`), server pri samotnom pípnutí prepočíta
   * nanovo a nezávisle, tento údaj sa naň nijako nespolieha. */
  punchState: { workplaceId: string; nextZmenaDirection: "in" | "out"; nextPrestavkaDirection: "in" | "out" | null }[];
  days: (typeof attendanceDays.$inferSelect)[];
  requests: (typeof punchCorrectionRequests.$inferSelect)[];
  missingPunchRequests: (typeof missingPunchRequests.$inferSelect)[];
};

export async function getMyAttendance(user: CurrentUser): Promise<MyAttendance | null> {
  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select().from(employees).where(eq(employees.userId, user.id));
    if (!employee) return null;

    const since = new Date();
    since.setDate(since.getDate() - 30);
    const sinceStr = localDateStr(since);

    const [workplaceRows, days, requests, missingRequests, currentPosition] = await Promise.all([
      tx
        .select({
          workplaceId: employeeWorkplaces.workplaceId,
          workplaceName: workplaces.name,
          isPrimary: employeeWorkplaces.isPrimary,
        })
        .from(employeeWorkplaces)
        .innerJoin(workplaces, eq(workplaces.id, employeeWorkplaces.workplaceId))
        .where(eq(employeeWorkplaces.employeeId, employee.id)),

      tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.employeeId, employee.id), gte(attendanceDays.date, sinceStr)))
        .orderBy(desc(attendanceDays.date)),

      tx
        .select()
        .from(punchCorrectionRequests)
        .where(eq(punchCorrectionRequests.employeeId, employee.id))
        .orderBy(desc(punchCorrectionRequests.createdAt)),

      tx
        .select()
        .from(missingPunchRequests)
        .where(eq(missingPunchRequests.employeeId, employee.id))
        .orderBy(desc(missingPunchRequests.createdAt)),

      tx
        .select({ breakTrackingMode: positions.breakTrackingMode })
        .from(employeePositionHistory)
        .innerJoin(positions, eq(positions.id, employeePositionHistory.positionId))
        .where(and(eq(employeePositionHistory.employeeId, employee.id), isNull(employeePositionHistory.validTo)))
        .then((rows) => rows[0]),
    ]);

    const canPunchBreaks =
      resolveBreakTrackingMode(currentPosition ?? null, {
        overrideBreakTrackingMode: employee.overrideBreakTrackingMode,
      }) === "pipa";

    const todayStr = localDateStr(new Date());
    const punchState = await Promise.all(
      workplaceRows.map(async (w) => {
        const zmena = await determineDirection(tx, employee.id, w.workplaceId, todayStr, "zmena");
        const prestavka = canPunchBreaks
          ? await determineDirection(tx, employee.id, w.workplaceId, todayStr, "prestavka")
          : null;
        return {
          workplaceId: w.workplaceId,
          nextZmenaDirection: zmena.direction,
          nextPrestavkaDirection: prestavka?.direction ?? null,
        };
      }),
    );

    // Otvorená zmena ("V práci") — `worked_hours` v DB sa dopočíta až po
    // odpípaní odchodu (`calculateAttendanceDay`), dovtedy by tu bola 0 aj po
    // hodinách práce. Toto je ČISTO zobrazenie (nič sa nezapisuje) — živý
    // prepočet z príchodu a skutočne odpípaných prestávok toho dňa.
    const now = new Date();
    const liveDays = await Promise.all(
      days.map(async (day) => {
        if (day.status !== "working" || !day.actualStart) return day;
        const breakEvents = await eventsForLocalDate(tx, employee.id, day.workplaceId, day.date, "prestavka");
        return { ...day, workedHours: liveWorkedHours(day.actualStart, breakEvents, now).toFixed(3) };
      }),
    );

    return {
      employeeId: employee.id,
      canPunchWeb: employee.canPunchWeb,
      canPunchBreaks,
      workplaces: workplaceRows,
      punchState,
      days: liveDays,
      requests,
      missingPunchRequests: missingRequests,
    };
  });
}

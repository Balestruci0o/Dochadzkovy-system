import { and, between, eq } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { absences, attendanceDays, employees, holidays, publishedShifts, shiftTemplates } from "@/lib/db/schema";
import { daysInMonth, toDateStr } from "@/lib/shared/dates";
import type { AbsenceKind } from "@/components/calendar/absence-kinds";

export type MyCalendarCell = {
  kind: "shift" | "absence";
  templateName: string | null;
  templateCode: string | null;
  templateColor: string | null;
  startTime: string | null;
  endTime: string | null;
  absenceKind: AbsenceKind | null;
  attendanceStatus: string | null;
  workedHours: number | null;
};

export type MyMonthCalendar = {
  employeeName: string;
  cells: Record<string, MyCalendarCell>;
  holidays: Record<string, string>;
};

export async function getMyMonthCalendar(
  user: CurrentUser,
  year: number,
  month: number,
): Promise<MyMonthCalendar | null> {
  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx
      .select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(eq(employees.userId, user.id));
    if (!employee) return null;

    const firstDate = toDateStr(year, month, 1);
    const lastDate = toDateStr(year, month, daysInMonth(year, month));

    const [shiftRows, absenceRows, attendanceRows, holidayRows] = await Promise.all([
      // Zverejnenie rozvrhu — VÝHRADNE `published_shifts` (zrkadlová snímka
      // zapísaná pri "Zverejniť rozvrh"), NIKDY `scheduled_shifts` priamo.
      // Tá je živý pracovný návrh manažéra, priebežne prepisovaný aj
      // regeneráciou — zamestnanec ho nesmie vidieť pred zverejnením.
      tx
        .select({
          date: publishedShifts.date,
          startTime: publishedShifts.startTime,
          endTime: publishedShifts.endTime,
          templateName: shiftTemplates.name,
          templateCode: shiftTemplates.code,
          templateColor: shiftTemplates.color,
        })
        .from(publishedShifts)
        .leftJoin(shiftTemplates, eq(shiftTemplates.id, publishedShifts.shiftTemplateId))
        .where(and(eq(publishedShifts.employeeId, employee.id), between(publishedShifts.date, firstDate, lastDate))),

      tx
        .select()
        .from(absences)
        .where(and(eq(absences.employeeId, employee.id), between(absences.date, firstDate, lastDate))),

      tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.employeeId, employee.id), between(attendanceDays.date, firstDate, lastDate))),

      tx.select({ date: holidays.date, name: holidays.name }).from(holidays).where(between(holidays.date, firstDate, lastDate)),
    ]);

    const cells: Record<string, MyCalendarCell> = {};

    for (const s of shiftRows) {
      cells[s.date] = {
        kind: "shift",
        templateName: s.templateName,
        templateCode: s.templateCode,
        templateColor: s.templateColor,
        startTime: s.startTime,
        endTime: s.endTime,
        absenceKind: null,
        attendanceStatus: null,
        workedHours: null,
      };
    }

    for (const a of absenceRows) {
      cells[a.date] = {
        kind: "absence",
        templateName: null,
        templateCode: null,
        templateColor: null,
        startTime: null,
        endTime: null,
        absenceKind: a.kind,
        attendanceStatus: null,
        workedHours: null,
      };
    }

    for (const ad of attendanceRows) {
      const existing = cells[ad.date];
      if (existing) {
        existing.attendanceStatus = ad.status;
        existing.workedHours = ad.workedHours ? Number(ad.workedHours) : null;
      }
    }

    return {
      employeeName: `${employee.firstName} ${employee.lastName}`,
      cells,
      holidays: Object.fromEntries(holidayRows.map((h) => [h.date, h.name])),
    };
  });
}

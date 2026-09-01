import { and, asc, between, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  absences,
  attendanceDays,
  coverageRequirements,
  employeePositionHistory,
  employees,
  employeeWorkplaces,
  holidays,
  positions,
  scheduledShifts,
  shiftLeaderAssignments,
  scheduleViolations,
  shiftTemplates,
  workplaces,
} from "@/lib/db/schema";
import { daysInMonth, toDateStr } from "@/lib/shared/dates";
import type { AbsenceKind } from "@/components/calendar/absence-kinds";
import { findSchedule } from "./schedule";

export type CalendarEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  positionId: string | null;
  positionName: string | null;
  positionColor: string | null;
  avatarColor: string | null;
  canBeShiftLeader: boolean;
};

export type CalendarShiftTemplate = {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  crossesMidnight: boolean;
  color: string | null;
};

export type CalendarCell = {
  kind: "shift" | "absence";
  shiftTemplateId: string | null;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number | null;
  crossesMidnight: boolean;
  source: "generated" | "manual" | "regenerated" | null;
  locked: boolean;
  absenceKind: AbsenceKind | null;
  attendanceStatus: string | null;
  workedHours: number | null;
};

export type CoverageRule = {
  id: string;
  positionId: string | null;
  positionName: string | null;
  minPeople: number;
  maxPeople: number | null;
  weekdays: number[] | null;
  appliesHolidays: boolean;
  isHard: boolean;
};

export type CalendarViolation = {
  id: string;
  date: string;
  employeeId: string | null;
  employeeName: string | null;
  positionId: string | null;
  positionName: string | null;
  severity: "gap" | "hard_violation" | "soft_violation";
  ruleCode: string;
  message: string;
};

/** Vedúci smeny, krok 5 — pozícia, čo vyžaduje vedúceho (`positions.requires_shift_leader`). */
export type LeaderPosition = { id: string; name: string };

/** Vedúci smeny, krok 5 — kto vedie danú (pozícia, deň), ak je už rozhodnuté. `employeeId: null` = VEDOMÁ voľba "žiadny vedúci" (LEN pri `source: 'manual'`). */
export type CalendarShiftLeader = {
  employeeId: string | null;
  employeeName: string | null;
  source: "generated" | "manual" | "regenerated";
};

export type CalendarData = {
  workplace: { id: string; name: string } | null;
  allWorkplaces: { id: string; name: string }[];
  employees: CalendarEmployee[];
  shiftTemplates: CalendarShiftTemplate[];
  cells: Record<string, CalendarCell>;
  coverageRules: CoverageRule[];
  violations: CalendarViolation[];
  scheduleStatus: "draft" | "published" | null;
  holidays: Record<string, string>;
  leaderPositions: LeaderPosition[];
  /** Kľúč `"positionId|date"`, rovnaký vzor ako `cells`. */
  shiftLeaders: Record<string, CalendarShiftLeader>;
};

function cellKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

function leaderKey(positionId: string, date: string): string {
  return `${positionId}|${date}`;
}

export async function getCalendarData(
  user: CurrentUser,
  requestedWorkplaceId: string | undefined,
  year: number,
  month: number,
): Promise<CalendarData> {
  return withUserContext(user.id, async (tx) => {
    // Nielen org-scoped, ale aj skutočne PRÍSTUPNÉ tomuto používateľovi
    // (accessible_workplaces(), rovnaká funkcia ako RLS) — inak by sa
    // manažérovi bez prístupu k Hotelu mohol defaultne vybrať Hotel ako
    // prvá prevádzka abecedne, a keďže naň nemá RLS prístup, kalendár by mu
    // ticho ukázal 0 zamestnancov namiesto jeho vlastnej prevádzky.
    const allWorkplaces = await tx
      .select({ id: workplaces.id, name: workplaces.name })
      .from(workplaces)
      .where(and(eq(workplaces.orgId, user.orgId), sql`${workplaces.id} IN (SELECT accessible_workplaces())`))
      .orderBy(asc(workplaces.name));

    const workplace =
      allWorkplaces.find((w) => w.id === requestedWorkplaceId) ?? allWorkplaces[0] ?? null;

    if (!workplace) {
      return {
        workplace: null,
        allWorkplaces,
        employees: [],
        shiftTemplates: [],
        cells: {},
        coverageRules: [],
        violations: [],
        scheduleStatus: null,
        holidays: {},
        leaderPositions: [],
        shiftLeaders: {},
      };
    }

    const firstDate = toDateStr(year, month, 1);
    const lastDate = toDateStr(year, month, daysInMonth(year, month));

    const [employeeRows, shiftTemplateRows, coverageRows, schedule, holidayRows, leaderPositionRows] = await Promise.all([
      tx
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          avatarColor: employees.avatarColor,
          canBeShiftLeader: employees.canBeShiftLeader,
          positionId: positions.id,
          positionName: positions.name,
          positionColor: positions.color,
        })
        .from(employeeWorkplaces)
        .innerJoin(employees, eq(employees.id, employeeWorkplaces.employeeId))
        .leftJoin(
          employeePositionHistory,
          and(eq(employeePositionHistory.employeeId, employees.id), isNull(employeePositionHistory.validTo)),
        )
        .leftJoin(positions, eq(positions.id, employeePositionHistory.positionId))
        .where(and(eq(employeeWorkplaces.workplaceId, workplace.id), eq(employees.isActive, true)))
        .orderBy(asc(employees.lastName), asc(employees.firstName)),

      tx
        .select({
          id: shiftTemplates.id,
          name: shiftTemplates.name,
          code: shiftTemplates.code,
          startTime: shiftTemplates.startTime,
          endTime: shiftTemplates.endTime,
          breakMinutes: shiftTemplates.breakMinutes,
          crossesMidnight: shiftTemplates.crossesMidnight,
          color: shiftTemplates.color,
        })
        .from(shiftTemplates)
        .where(and(eq(shiftTemplates.workplaceId, workplace.id), eq(shiftTemplates.isActive, true)))
        .orderBy(asc(shiftTemplates.startTime)),

      tx
        .select({
          id: coverageRequirements.id,
          positionId: coverageRequirements.positionId,
          positionName: positions.name,
          minPeople: coverageRequirements.minPeople,
          maxPeople: coverageRequirements.maxPeople,
          weekdays: coverageRequirements.weekdays,
          appliesHolidays: coverageRequirements.appliesHolidays,
          isHard: coverageRequirements.isHard,
        })
        .from(coverageRequirements)
        .leftJoin(positions, eq(positions.id, coverageRequirements.positionId))
        .where(and(eq(coverageRequirements.workplaceId, workplace.id), eq(coverageRequirements.isActive, true))),

      findSchedule(tx, workplace.id, year, month),

      tx
        .select({ date: holidays.date, name: holidays.name })
        .from(holidays)
        .where(between(holidays.date, firstDate, lastDate)),

      // Vedúci smeny, krok 5 — pozície TEJTO prevádzky (aj org-wide,
      // `workplace_id IS NULL`), čo vyžadujú vedúceho. Org-scoped
      // (`user.orgId`) — `workplace_id IS NULL` samo osebe by inak
      // zachytilo aj org-wide pozície INEJ organizácie (rovnaký vzor ako
      // `db-loader.ts`).
      tx
        .select({ id: positions.id, name: positions.name })
        .from(positions)
        .where(
          and(
            eq(positions.orgId, user.orgId),
            sql`(${positions.workplaceId} = ${workplace.id} OR ${positions.workplaceId} IS NULL)`,
            eq(positions.requiresShiftLeader, true),
            eq(positions.isActive, true),
          ),
        ),
    ]);

    const employeeIds = employeeRows.map((e) => e.id);

    const [shiftRows, absenceRows, attendanceRows, violationRows, shiftLeaderRows] = await Promise.all([
      employeeIds.length
        ? tx
            .select()
            .from(scheduledShifts)
            .where(and(eq(scheduledShifts.workplaceId, workplace.id), between(scheduledShifts.date, firstDate, lastDate)))
        : Promise.resolve([]),

      employeeIds.length
        ? tx
            .select()
            .from(absences)
            .where(and(inArray(absences.employeeId, employeeIds), between(absences.date, firstDate, lastDate)))
        : Promise.resolve([]),

      employeeIds.length
        ? tx
            .select()
            .from(attendanceDays)
            .where(and(inArray(attendanceDays.employeeId, employeeIds), between(attendanceDays.date, firstDate, lastDate)))
        : Promise.resolve([]),

      schedule
        ? tx
            .select({
              id: scheduleViolations.id,
              date: scheduleViolations.date,
              employeeId: scheduleViolations.employeeId,
              employeeFirstName: employees.firstName,
              employeeLastName: employees.lastName,
              positionId: scheduleViolations.positionId,
              positionName: positions.name,
              severity: scheduleViolations.severity,
              ruleCode: scheduleViolations.ruleCode,
              message: scheduleViolations.message,
            })
            .from(scheduleViolations)
            .leftJoin(employees, eq(employees.id, scheduleViolations.employeeId))
            .leftJoin(positions, eq(positions.id, scheduleViolations.positionId))
            .where(and(eq(scheduleViolations.scheduleId, schedule.id), eq(scheduleViolations.resolved, false)))
        : Promise.resolve([]),

      // Vedúci smeny, krok 5 — už rozhodnutí vedúci tohto mesiaca (generovaní aj ručne nastavení).
      leaderPositionRows.length
        ? tx
            .select({
              positionId: shiftLeaderAssignments.positionId,
              date: shiftLeaderAssignments.date,
              employeeId: shiftLeaderAssignments.employeeId,
              source: shiftLeaderAssignments.source,
              employeeFirstName: employees.firstName,
              employeeLastName: employees.lastName,
            })
            .from(shiftLeaderAssignments)
            .leftJoin(employees, eq(employees.id, shiftLeaderAssignments.employeeId))
            .where(and(eq(shiftLeaderAssignments.workplaceId, workplace.id), between(shiftLeaderAssignments.date, firstDate, lastDate)))
        : Promise.resolve([]),
    ]);

    const cells: Record<string, CalendarCell> = {};

    for (const s of shiftRows) {
      cells[cellKey(s.employeeId, s.date)] = {
        kind: "shift",
        shiftTemplateId: s.shiftTemplateId,
        startTime: s.startTime,
        endTime: s.endTime,
        breakMinutes: s.breakMinutes,
        crossesMidnight: s.crossesMidnight,
        source: s.source,
        locked: s.locked,
        absenceKind: null,
        attendanceStatus: null,
        workedHours: null,
      };
    }

    for (const a of absenceRows) {
      cells[cellKey(a.employeeId, a.date)] = {
        kind: "absence",
        shiftTemplateId: null,
        startTime: null,
        endTime: null,
        breakMinutes: null,
        crossesMidnight: false,
        source: null,
        locked: false,
        absenceKind: a.kind,
        attendanceStatus: null,
        workedHours: null,
      };
    }

    for (const ad of attendanceRows) {
      const key = cellKey(ad.employeeId, ad.date);
      const existing = cells[key];
      if (existing) {
        existing.attendanceStatus = ad.status;
        existing.workedHours = ad.workedHours ? Number(ad.workedHours) : null;
      }
    }

    const shiftLeaders: Record<string, CalendarShiftLeader> = {};
    for (const r of shiftLeaderRows) {
      shiftLeaders[leaderKey(r.positionId, r.date)] = {
        employeeId: r.employeeId,
        employeeName: r.employeeId ? `${r.employeeFirstName} ${r.employeeLastName}` : null,
        source: r.source,
      };
    }

    return {
      workplace,
      allWorkplaces,
      employees: employeeRows,
      shiftTemplates: shiftTemplateRows,
      cells,
      coverageRules: coverageRows,
      violations: violationRows.map((v) => ({
        id: v.id,
        date: v.date,
        employeeId: v.employeeId,
        employeeName: v.employeeId ? `${v.employeeFirstName} ${v.employeeLastName}` : null,
        positionId: v.positionId,
        positionName: v.positionName,
        severity: v.severity,
        ruleCode: v.ruleCode,
        message: v.message,
      })),
      scheduleStatus: schedule?.status ?? null,
      holidays: Object.fromEntries(holidayRows.map((h) => [h.date, h.name])),
      leaderPositions: leaderPositionRows,
      shiftLeaders,
    };
  });
}

import { and, eq, gte, lte, ne } from "drizzle-orm";
import type { AbsenceKind } from "@/components/calendar/absence-kinds";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { absenceRequests, absences, employees, employeeWorkplaces, workplaces } from "@/lib/db/schema";

export type PendingAbsenceRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  workplaceId: string;
  workplaceName: string;
  kind: AbsenceKind;
  dateFrom: string;
  dateTo: string;
  isPartialDay: boolean;
  hours: number | null;
  reason: string | null;
  requestedAt: Date;
  /**
   * Bod 5 — "pri schvaľovaní vidí, kto ešte má v tom
   * termíne voľno" — INÍ zamestnanci (nie žiadateľ) s UŽ SCHVÁLENOU
   * absenciou prekrývajúcou sa s [dateFrom, dateTo] v tej istej prevádzke.
   */
  othersOffInPeriod: { employeeId: string; employeeName: string; date: string }[];
};

/** RLS (`req_select`) obmedzí na prevádzky, ku ktorým má manažér/owner prístup. */
export async function getPendingAbsenceRequests(user: CurrentUser): Promise<PendingAbsenceRequest[]> {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({
        id: absenceRequests.id,
        employeeId: absenceRequests.employeeId,
        employeeFirstName: employees.firstName,
        employeeLastName: employees.lastName,
        workplaceId: absenceRequests.workplaceId,
        workplaceName: workplaces.name,
        kind: absenceRequests.kind,
        dateFrom: absenceRequests.dateFrom,
        dateTo: absenceRequests.dateTo,
        isPartialDay: absenceRequests.isPartialDay,
        hours: absenceRequests.hours,
        reason: absenceRequests.reason,
        requestedAt: absenceRequests.requestedAt,
      })
      .from(absenceRequests)
      .innerJoin(employees, eq(employees.id, absenceRequests.employeeId))
      .innerJoin(workplaces, eq(workplaces.id, absenceRequests.workplaceId))
      .where(eq(absenceRequests.status, "pending"))
      .orderBy(absenceRequests.requestedAt);

    const withContext = await Promise.all(
      rows.map(async (r) => {
        const others = await tx
          .select({
            employeeId: absences.employeeId,
            employeeFirstName: employees.firstName,
            employeeLastName: employees.lastName,
            date: absences.date,
          })
          .from(absences)
          .innerJoin(employees, eq(employees.id, absences.employeeId))
          .where(
            and(
              eq(absences.workplaceId, r.workplaceId),
              eq(absences.isConfirmed, true),
              ne(absences.employeeId, r.employeeId),
              gte(absences.date, r.dateFrom),
              lte(absences.date, r.dateTo),
            ),
          )
          .orderBy(absences.date);

        return {
          id: r.id,
          employeeId: r.employeeId,
          employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
          workplaceId: r.workplaceId,
          workplaceName: r.workplaceName,
          kind: r.kind,
          dateFrom: r.dateFrom,
          dateTo: r.dateTo,
          isPartialDay: r.isPartialDay,
          hours: r.hours ? Number(r.hours) : null,
          reason: r.reason,
          requestedAt: r.requestedAt,
          othersOffInPeriod: others.map((o) => ({ employeeId: o.employeeId, employeeName: `${o.employeeFirstName} ${o.employeeLastName}`, date: o.date })),
        };
      }),
    );

    return withContext;
  });
}

export type EmployeeOption = { id: string; name: string; workplaceId: string; workplaceName: string };

/** Pre formulár "zadať žiadosť za zamestnanca" — RLS (`employees_select`/`employee_workplaces`) obmedzí na dostupné prevádzky. */
export async function getEmployeeOptionsForManager(user: CurrentUser): Promise<EmployeeOption[]> {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        workplaceId: employeeWorkplaces.workplaceId,
        workplaceName: workplaces.name,
      })
      .from(employees)
      .innerJoin(employeeWorkplaces, eq(employeeWorkplaces.employeeId, employees.id))
      .innerJoin(workplaces, eq(workplaces.id, employeeWorkplaces.workplaceId))
      .where(eq(employees.isActive, true))
      .orderBy(employees.firstName, employees.lastName);

    return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`, workplaceId: r.workplaceId, workplaceName: r.workplaceName }));
  });
}

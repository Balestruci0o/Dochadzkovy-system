import { and, asc, eq, isNull } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import {
  employeePositionHistory,
  employees,
  employeeWorkplaces,
  positions,
  workplaces,
} from "@/lib/db/schema";

export type EmployeeListRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  isActive: boolean;
  positionName: string | null;
  positionColor: string | null;
  workplaces: { id: string; name: string }[];
};

/**
 * Zoznam zamestnancov s aktuálnou pozíciou a prevádzkami. RLS (emp_select)
 * už sama obmedzí, koho manažér/owner vôbec uvidí — tu netreba nič filtrovať
 * naviac podľa role.
 */
export async function listEmployees(user: CurrentUser): Promise<EmployeeListRow[]> {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
        isActive: employees.isActive,
        positionName: positions.name,
        positionColor: positions.color,
      })
      .from(employees)
      .leftJoin(
        employeePositionHistory,
        and(
          eq(employeePositionHistory.employeeId, employees.id),
          isNull(employeePositionHistory.validTo),
        ),
      )
      .leftJoin(positions, eq(positions.id, employeePositionHistory.positionId))
      .where(eq(employees.orgId, user.orgId))
      .orderBy(asc(employees.lastName), asc(employees.firstName));

    const workplaceRows = await tx
      .select({
        employeeId: employeeWorkplaces.employeeId,
        workplaceId: workplaces.id,
        workplaceName: workplaces.name,
      })
      .from(employeeWorkplaces)
      .innerJoin(workplaces, eq(workplaces.id, employeeWorkplaces.workplaceId));

    const workplacesByEmployee = new Map<string, { id: string; name: string }[]>();
    for (const w of workplaceRows) {
      const list = workplacesByEmployee.get(w.employeeId) ?? [];
      list.push({ id: w.workplaceId, name: w.workplaceName });
      workplacesByEmployee.set(w.employeeId, list);
    }

    return rows.map((r) => ({
      ...r,
      workplaces: workplacesByEmployee.get(r.id) ?? [],
    }));
  });
}

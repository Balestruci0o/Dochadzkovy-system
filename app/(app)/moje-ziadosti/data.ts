import { desc, eq } from "drizzle-orm";
import type { AbsenceKind } from "@/components/calendar/absence-kinds";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { absenceRequests, employees } from "@/lib/db/schema";

export type MyAbsenceRequest = {
  id: string;
  kind: AbsenceKind;
  dateFrom: string;
  dateTo: string;
  isPartialDay: boolean;
  hours: number | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionNote: string | null;
  requestedAt: Date;
};

export async function getMyAbsenceRequests(user: CurrentUser): Promise<MyAbsenceRequest[] | null> {
  return withUserContext(user.id, async (tx) => {
    const [employee] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, user.id));
    if (!employee) return null;

    const rows = await tx
      .select()
      .from(absenceRequests)
      .where(eq(absenceRequests.employeeId, employee.id))
      .orderBy(desc(absenceRequests.requestedAt));

    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      isPartialDay: r.isPartialDay,
      hours: r.hours ? Number(r.hours) : null,
      reason: r.reason,
      status: r.status,
      decisionNote: r.decisionNote,
      requestedAt: r.requestedAt,
    }));
  });
}

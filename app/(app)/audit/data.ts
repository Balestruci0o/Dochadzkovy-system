import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { auditLog, employees, users } from "@/lib/db/schema";
import { type AuditAction, describeAuditEntry, tableLabel, TABLE_LABELS } from "@/lib/audit/describe";

export const PAGE_SIZE = 50;

export type AuditFilters = {
  changedBy?: string;
  tableName?: string;
  /** Konkrétny `record_id` — napr. história zmien JEDNÉHO zamestnanca/žiadosti odkiaľkoľvek z appky, nie len z /audit filtrov. */
  recordId?: string;
  action?: AuditAction;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
};

export type AuditRow = {
  id: number;
  recordId: string;
  changedAt: Date;
  tableName: string;
  tableLabel: string;
  action: AuditAction;
  actionLabel: string;
  changedByLabel: string;
  subjectLabel: string | null;
  extra: string | null;
  sensitive: boolean;
};

export type AuditLogPageData = {
  rows: AuditRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  filterOptions: {
    users: { id: string; label: string }[];
    tables: { value: string; label: string }[];
  };
};

/**
 * Audit log stránka (len owner, viď RLS `audit_log_select_owner`) — `changed_by`
 * NEMÁ FK (viď schema.ts), takže môže ukazovať na dávno zmazaného používateľa;
 * `NULL` znamená zápis bez `app.user_id` (cron/generátor/seed). Oboje sa v UI
 * musí dať zobraziť bez pádu, nie len pre "bežných" používateľov.
 *
 * Meno zamestnanca (`subjectLabel`) sa pre iné tabuľky než `employees` dorieši
 * DÁVKOVÝM joinom len za aktuálnu STRÁNKU výsledkov (nie za všetkých 87k+
 * riadkov) — `describeAuditEntry` je čistá funkcia bez DB prístupu zámerne.
 */
export async function getAuditLogPage(user: CurrentUser, filters: AuditFilters): Promise<AuditLogPageData> {
  return withUserContext(user.id, async (tx) => {
    const page = Math.max(1, filters.page ?? 1);

    const conditions = [
      // RLS (audit_log_select_owner, migrácia 0045) toto už vynucuje
      // nezávisle — tento riadok je druhá vrstva, nie jediná obrana proti
      // cross-org úniku medzi organizáciami.
      eq(auditLog.orgId, user.orgId),
      filters.changedBy ? eq(auditLog.changedBy, filters.changedBy) : undefined,
      filters.tableName ? eq(auditLog.tableName, filters.tableName) : undefined,
      filters.recordId ? eq(auditLog.recordId, filters.recordId) : undefined,
      filters.action ? eq(auditLog.action, filters.action) : undefined,
      filters.dateFrom ? gte(auditLog.changedAt, new Date(`${filters.dateFrom}T00:00:00Z`)) : undefined,
      filters.dateTo ? lt(auditLog.changedAt, new Date(new Date(`${filters.dateTo}T00:00:00Z`).getTime() + 86400000)) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [{ count }], allUsers] = await Promise.all([
      tx
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.changedAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      tx.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where),
      tx.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users),
    ]);

    const employeeIds = [...new Set(rows.flatMap((r) => describeAuditEntry({ tableName: r.tableName, action: r.action as AuditAction, oldData: r.oldData as Record<string, unknown> | null, newData: r.newData as Record<string, unknown> | null }).employeeIds))];
    const employeeRows = employeeIds.length > 0 ? await tx.select({ id: employees.id, firstName: employees.firstName, lastName: employees.lastName }).from(employees).where(inArray(employees.id, employeeIds)) : [];
    const employeeNameById = new Map(employeeRows.map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
    const userLabelById = new Map(allUsers.map((u) => [u.id, u.fullName || u.email || "?"]));

    const describedRows: AuditRow[] = rows.map((r) => {
      const described = describeAuditEntry({
        tableName: r.tableName,
        action: r.action as AuditAction,
        oldData: r.oldData as Record<string, unknown> | null,
        newData: r.newData as Record<string, unknown> | null,
      });
      const employeeNames = described.employeeIds.map((id) => employeeNameById.get(id) ?? null).filter((n): n is string => n !== null);

      return {
        id: r.id,
        recordId: r.recordId,
        changedAt: r.changedAt,
        tableName: r.tableName,
        tableLabel: tableLabel(r.tableName),
        action: r.action as AuditAction,
        actionLabel: described.actionLabel,
        changedByLabel: r.changedBy ? (userLabelById.get(r.changedBy) ?? "Neznámy / zmazaný používateľ") : "Systém (bez prihláseného používateľa — cron, generátor)",
        subjectLabel: employeeNames.length > 0 ? employeeNames.join(" + ") : null,
        extra: described.extra,
        sensitive: described.sensitive,
      };
    });

    return {
      rows: describedRows,
      totalCount: count,
      page,
      pageSize: PAGE_SIZE,
      filterOptions: {
        users: allUsers.filter((u) => u.id).map((u) => ({ id: u.id, label: u.fullName || u.email || "?" })),
        tables: Object.entries(TABLE_LABELS).map(([value, label]) => ({ value, label })),
      },
    };
  });
}

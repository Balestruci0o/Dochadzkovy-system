import Link from "next/link";
import { AuditLogTable } from "@/components/audit/audit-log-table";
import type { AuditAction } from "@/lib/audit/describe";
import { requireRole } from "@/lib/auth/session";
import { getAuditLogPage } from "./data";

const ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: "INSERT", label: "Vytvorenie" },
  { value: "UPDATE", label: "Úprava" },
  { value: "DELETE", label: "Zmazanie" },
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ changedBy?: string; tableName?: string; action?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await requireRole("owner");
  const { changedBy, tableName, action, from, to, page } = await searchParams;

  const validAction = action === "INSERT" || action === "UPDATE" || action === "DELETE" ? action : undefined;
  const pageNum = Number(page) > 0 ? Number(page) : 1;

  const data = await getAuditLogPage(user, {
    changedBy: changedBy || undefined,
    tableName: tableName || undefined,
    action: validAction,
    dateFrom: from || undefined,
    dateTo: to || undefined,
    page: pageNum,
  });

  function filterHref(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams();
    const merged = { changedBy, tableName, action, from, to, ...overrides };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/audit?${params.toString()}`;
  }

  const totalPages = Math.max(1, Math.ceil(data.totalCount / data.pageSize));

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-paper p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Od
          <input
            type="date"
            name="from"
            defaultValue={from ?? ""}
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Do
          <input
            type="date"
            name="to"
            defaultValue={to ?? ""}
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Používateľ
          <select
            name="changedBy"
            defaultValue={changedBy ?? ""}
            className="min-w-[180px] rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          >
            <option value="">— všetci —</option>
            {data.filterOptions.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Oblasť
          <select
            name="tableName"
            defaultValue={tableName ?? ""}
            className="min-w-[160px] rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          >
            <option value="">— všetky —</option>
            {data.filterOptions.tables.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Akcia
          <select
            name="action"
            defaultValue={action ?? ""}
            className="min-w-[140px] rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          >
            <option value="">— všetky —</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark">
          Filtrovať
        </button>
        {(changedBy || tableName || action || from || to) && (
          <Link href="/audit" className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2">
            Zrušiť filtre
          </Link>
        )}
      </form>

      <div className="flex items-center justify-between text-sm text-ink-soft">
        <span>
          <b className="text-ink">{data.totalCount.toLocaleString("sk-SK")}</b> záznamov
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Link
              href={filterHref({ page: String(Math.max(1, pageNum - 1)) })}
              aria-disabled={pageNum <= 1}
              className={`rounded-md border border-line px-3 py-1.5 font-semibold transition ${pageNum <= 1 ? "pointer-events-none opacity-40" : "text-ink-soft hover:bg-cream-2"}`}
            >
              ‹ Novšie
            </Link>
            <span>
              Strana {pageNum} / {totalPages}
            </span>
            <Link
              href={filterHref({ page: String(Math.min(totalPages, pageNum + 1)) })}
              aria-disabled={pageNum >= totalPages}
              className={`rounded-md border border-line px-3 py-1.5 font-semibold transition ${pageNum >= totalPages ? "pointer-events-none opacity-40" : "text-ink-soft hover:bg-cream-2"}`}
            >
              Staršie ›
            </Link>
          </div>
        )}
      </div>

      <AuditLogTable rows={data.rows} />
    </div>
  );
}

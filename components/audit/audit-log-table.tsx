import type { AuditRow } from "@/app/(app)/audit/data";

function fullDateTime(date: Date): string {
  return new Date(date).toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Bratislava" });
}

const ACTION_BADGE: Record<AuditRow["action"], string> = {
  INSERT: "bg-sage-tint text-sage-dark",
  UPDATE: "bg-gold-tint text-gold",
  DELETE: "bg-late-tint text-late",
};

/** Audit log — zoznam, najnovšie hore (dopyt v data.ts je zoradený server-side). */
export function AuditLogTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <div className="rounded-[14px] border border-line bg-paper p-6 text-center text-sm text-ink-soft shadow-sm">Žiadne záznamy pre zvolené filtre.</div>;
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-cream text-left text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            <th className="px-3.5 py-2.5">Kedy</th>
            <th className="px-3.5 py-2.5">Kto</th>
            <th className="px-3.5 py-2.5">Akcia</th>
            <th className="px-3.5 py-2.5">Na čom</th>
            <th className="px-3.5 py-2.5">Oblasť</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line-soft last:border-b-0 hover:bg-cream-2">
              <td className="whitespace-nowrap px-3.5 py-2.5 tabular-nums text-ink-soft">{fullDateTime(r.changedAt)}</td>
              <td className="px-3.5 py-2.5 text-ink">{r.changedByLabel}</td>
              <td className="px-3.5 py-2.5">
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${ACTION_BADGE[r.action]}`}>{r.actionLabel}</span>
                {r.sensitive && (
                  <span className="ml-1.5 text-xs font-semibold text-late" title="Citlivé — mzdová sadzba alebo trvalé zmazanie osobných údajov">
                    ⚠
                  </span>
                )}
              </td>
              <td className="px-3.5 py-2.5 text-ink-soft">
                {r.subjectLabel}
                {r.subjectLabel && r.extra && " — "}
                {r.extra}
              </td>
              <td className="whitespace-nowrap px-3.5 py-2.5 text-ink-faint">{r.tableLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

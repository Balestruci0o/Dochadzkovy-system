import Link from "next/link";
import { AddMissingPunchCard } from "@/components/punch/add-missing-punch-card";
import { fmtHours } from "@/components/punch/attendance-status";
import { PunchOverviewTable } from "@/components/punch/punch-overview-table";
import { requireRole } from "@/lib/auth/session";
import { daysInMonth, toDateStr, todayStr } from "@/lib/shared/dates";
import { getPunchOverviewData } from "./data";

export default async function PipnutiaPage({
  searchParams,
}: {
  searchParams: Promise<{ workplace?: string; from?: string; to?: string; employeeId?: string }>;
}) {
  const user = await requireRole("owner", "manager");
  const { workplace: workplaceParam, from, to, employeeId } = await searchParams;

  const today = todayStr();
  const dateFrom = from || today;
  const dateTo = to || today;

  const data = await getPunchOverviewData(user, workplaceParam, dateFrom, dateTo, employeeId || undefined);

  const now = new Date();
  const monthStart = toDateStr(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = toDateStr(now.getFullYear(), now.getMonth() + 1, daysInMonth(now.getFullYear(), now.getMonth() + 1));

  function presetHref(f: string, t: string) {
    const wp = data.workplace ? `&workplace=${data.workplace.id}` : "";
    const emp = employeeId ? `&employeeId=${employeeId}` : "";
    return `/pipnutia?from=${f}&to=${t}${wp}${emp}`;
  }

  return (
    <div className="flex flex-col gap-4">
      {data.allWorkplaces.length > 1 && (
        <div className="flex items-center overflow-hidden self-start rounded-md border border-line">
          {data.allWorkplaces.map((w) => (
            <Link
              key={w.id}
              href={`/pipnutia?workplace=${w.id}&from=${dateFrom}&to=${dateTo}${employeeId ? `&employeeId=${employeeId}` : ""}`}
              className={`px-3.5 py-2 text-sm font-semibold transition-colors ${
                w.id === data.workplace?.id ? "bg-sage-tint text-sage-dark" : "text-ink-soft hover:bg-cream-2"
              }`}
            >
              {w.name}
            </Link>
          ))}
        </div>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-paper p-4 shadow-sm">
        {data.workplace && <input type="hidden" name="workplace" value={data.workplace.id} />}
        <label className="flex flex-col gap-1 text-sm text-ink">
          Od
          <input
            type="date"
            name="from"
            defaultValue={dateFrom}
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Do
          <input
            type="date"
            name="to"
            defaultValue={dateTo}
            className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Zamestnanec
          <select
            name="employeeId"
            defaultValue={employeeId ?? ""}
            className="min-w-[180px] rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
          >
            <option value="">— všetci —</option>
            {data.employeeOptions.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark"
        >
          Filtrovať
        </button>
        <div className="ml-auto flex gap-2">
          <Link
            href={presetHref(today, today)}
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
          >
            Dnes
          </Link>
          <Link
            href={presetHref(monthStart, monthEnd)}
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
          >
            Tento mesiac
          </Link>
        </div>
      </form>

      {!data.workplace ? (
        <div className="rounded-[14px] border border-line bg-paper p-6 text-sm text-ink-soft shadow-sm">
          Nemáš prístup k žiadnej prevádzke.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4 rounded-[14px] border border-line bg-paper p-4 shadow-sm">
            <span className="text-sm text-ink-soft">
              <b className="text-base text-ink">{data.totals.days}</b> odpracovaných dní
            </span>
            <span className="text-sm text-ink-soft">
              <b className="text-base text-ink">{fmtHours(data.totals.workedHours)}</b> spolu
            </span>
            <span className="text-sm text-ink-soft">
              <b className="text-base text-ink">{data.rows.length}</b> záznamov
            </span>
          </div>

          <AddMissingPunchCard workplaceId={data.workplace.id} employeeOptions={data.employeeOptions} />

          <PunchOverviewTable rows={data.rows} eventsByRow={data.eventsByRow} />
        </>
      )}
    </div>
  );
}

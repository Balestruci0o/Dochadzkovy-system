import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthCalendar } from "@/components/calendar/month-calendar";
import { requireRole } from "@/lib/auth/session";
import { monthLabel, shiftMonth } from "@/lib/shared/dates";
import { getMyMonthCalendar } from "./data";

export default async function MojRozvrhPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; m?: string }>;
}) {
  const user = await requireRole("employee");
  const { y, m } = await searchParams;

  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) && Number(m) >= 1 && Number(m) <= 12 ? Number(m) : now.getMonth() + 1;

  const data = await getMyMonthCalendar(user, year, month);
  if (!data) notFound();

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  function monthHref(y2: number, m2: number) {
    return `/moj-rozvrh?y=${y2}&m=${m2}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center overflow-hidden rounded-md border border-line">
          <Link
            href={monthHref(prev.year, prev.month)}
            className="flex items-center px-2.5 py-2 text-ink-soft hover:bg-cream-2"
            aria-label="Predchádzajúci mesiac"
          >
            <ChevronLeft size={16} />
          </Link>
          <span className="min-w-[168px] px-2 py-2 text-center text-sm font-semibold text-ink">
            {monthLabel(year, month)}
          </span>
          <Link
            href={monthHref(next.year, next.month)}
            className="flex items-center px-2.5 py-2 text-ink-soft hover:bg-cream-2"
            aria-label="Nasledujúci mesiac"
          >
            <ChevronRight size={16} />
          </Link>
        </div>
        <Link
          href={monthHref(now.getFullYear(), now.getMonth() + 1)}
          className="rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-cream-2"
        >
          Aktuálny mesiac
        </Link>
      </div>

      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <MonthCalendar year={year} month={month} cells={data.cells} holidays={data.holidays} />
      </div>
    </div>
  );
}

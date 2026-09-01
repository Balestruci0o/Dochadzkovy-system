import { ChevronLeft, ChevronRight, Download, FileText, Files } from "lucide-react";
import Link from "next/link";
import { ExportLink } from "@/components/reports/export-link";
import { canViewWages } from "@/lib/auth/manager-permissions";
import { requireRole } from "@/lib/auth/session";
import { absenceDaysToHours, REPORTED_ABSENCE_KINDS } from "@/lib/reports/monthly-summary";
import { monthLabel, shiftMonth } from "@/lib/shared/dates";
import { getVykazyData } from "./data";

/**
 * Fáza 4 (Mzdy) — "•••" namiesto sumy, keď viewer nemá view_wages. TOTO JE
 * LEN KOZMETIKA — bezpečnosť drží RLS (rate_select/salary_select mu bez
 * view_wages jednoducho nevráti riadky, grossWage vyjde ticho 0). Bez tejto
 * masky by "0,00 €" vyzeralo ako chyba dát namiesto úmyselne skrytej sumy.
 */
const HIDDEN_AMOUNT = "•••";

const ABSENCE_SHORT_LABELS: Record<string, string> = {
  dovolenka: "D",
  pn: "PN",
  ocr: "OČR",
  paragraf: "P",
  neplatene: "NV",
};

function fmtH(n: number): string {
  return n.toFixed(1).replace(".", ",");
}
function fmtEur(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}
/** Fáza 4 (Mzdy) — "•••" LEN keď je za tým skutočné číslo (null = neaplikovateľné, napr. hodinový nemá fix, nie skryté). */
function fmtEurOrDashMasked(n: number | null, canSeeWages: boolean): string {
  if (n === null) return "—";
  return canSeeWages ? fmtEur(n) : HIDDEN_AMOUNT;
}
function fmtEurMasked(n: number, canSeeWages: boolean): string {
  return canSeeWages ? fmtEur(n) : HIDDEN_AMOUNT;
}

export default async function VykazyPage({
  searchParams,
}: {
  searchParams: Promise<{ workplace?: string; y?: string; m?: string }>;
}) {
  const user = await requireRole("owner", "manager", "accountant");
  const { workplace: workplaceParam, y, m } = await searchParams;

  const now = new Date();
  const year = Number(y) || now.getFullYear();
  const month = Number(m) && Number(m) >= 1 && Number(m) <= 12 ? Number(m) : now.getMonth() + 1;

  const data = await getVykazyData(user, workplaceParam, year, month);
  const { summary } = data;
  const canSeeWages = canViewWages(user.role, user.permissions);
  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  function monthHref(y2: number, m2: number) {
    const wp = data.workplace ? `&workplace=${data.workplace.id}` : "";
    return `/vykazy?y=${y2}&m=${m2}${wp}`;
  }

  const excelHref = data.workplace
    ? `/api/vykazy/excel?workplaceId=${data.workplace.id}&year=${year}&month=${month}`
    : "#";
  const pdfSummaryHref = data.workplace
    ? `/api/vykazy/pdf?workplaceId=${data.workplace.id}&year=${year}&month=${month}`
    : "#";
  const pdfAllIndividualHref = data.workplace
    ? `/api/vykazy/pdf?workplaceId=${data.workplace.id}&year=${year}&month=${month}&all=1`
    : "#";
  function pdfEmployeeHref(employeeId: string) {
    return `/api/vykazy/pdf?workplaceId=${data.workplace?.id}&year=${year}&month=${month}&employeeId=${employeeId}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
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

        <div className="flex flex-wrap items-center gap-3">
          {data.allWorkplaces.length > 1 && (
            <div className="flex items-center overflow-hidden rounded-md border border-line">
              {data.allWorkplaces.map((w) => (
                <Link
                  key={w.id}
                  href={`/vykazy?y=${year}&m=${month}&workplace=${w.id}`}
                  className={`px-3.5 py-2 text-sm font-semibold transition-colors ${
                    w.id === data.workplace?.id ? "bg-sage-tint text-sage-dark" : "text-ink-soft hover:bg-cream-2"
                  }`}
                >
                  {w.name}
                </Link>
              ))}
            </div>
          )}
          {data.workplace && (
            <>
              <ExportLink
                href={pdfSummaryHref}
                className="flex items-center gap-1.5 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
              >
                <FileText size={16} />
                PDF prehľad
              </ExportLink>
              <ExportLink
                href={pdfAllIndividualHref}
                title="Jeden PDF súbor — individuálny výpis každého zamestnanca, jeden pod druhým"
                className="flex items-center gap-1.5 rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
              >
                <Files size={16} />
                Individuálne výpisy všetkých
              </ExportLink>
              <ExportLink
                href={excelHref}
                className="flex items-center gap-1.5 rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark"
              >
                <Download size={16} />
                Excel
              </ExportLink>
            </>
          )}
        </div>
      </div>

      {!data.workplace && (
        <div className="rounded-[14px] border border-line bg-paper p-6 text-sm text-ink-soft shadow-sm">
          Nemáš prístup k žiadnej prevádzke.
        </div>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Odpracované" value={`${fmtH(summary.totals.workedHours)} h`} meta="spolu za obdobie" />
            <StatCard label="Sviatok" value={`${fmtH(summary.totals.holidayHours)} h`} meta="§122 Zákonníka práce" />
            <StatCard
              label="Neprítomnosti"
              value={`${fmtH(REPORTED_ABSENCE_KINDS.reduce((s, k) => s + absenceDaysToHours(summary.totals.absenceDays[k]), 0))} h`}
              meta="D / PN / OČR / P / NV"
            />
            <StatCard label="Mzdy (hrubé)" value={fmtEurMasked(summary.totals.grossWage, canSeeWages)} meta="podklad pre mzdy" accent />
          </div>

          <div className="overflow-x-auto rounded-[14px] border border-line bg-paper shadow-sm">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="sticky left-0 z-[2] border-r border-line bg-paper px-4 py-3">Zamestnanec</th>
                  <th className="px-3 py-3 text-right">Odprac.</th>
                  <th className="px-3 py-3 text-right">Sviatok</th>
                  <th className="px-3 py-3 text-right">Nadčas</th>
                  <th className="px-3 py-3">Neprítomnosť</th>
                  <th className="px-3 py-3 text-right">Fix</th>
                  <th className="px-3 py-3 text-right">Variabilná</th>
                  <th className="px-4 py-3 text-right">Hrubá mzda</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {summary.employees.map((e) => {
                  const absenceParts = REPORTED_ABSENCE_KINDS.filter((k) => e.absenceDays[k] > 0).map(
                    (k) => `${ABSENCE_SHORT_LABELS[k]} ${fmtH(absenceDaysToHours(e.absenceDays[k]))}h`,
                  );
                  return (
                    <tr key={e.employeeId} className="border-b border-line-soft last:border-0">
                      <td className="sticky left-0 z-[1] border-r border-line-soft bg-paper px-4 py-3">
                        <div className="font-semibold text-ink">{e.name}</div>
                        {e.positionName && <div className="text-xs text-ink-faint">{e.positionName}</div>}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{fmtH(e.workedHours)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${e.holidayHours ? "text-ink" : "text-ink-faint"}`}>
                        {e.holidayHours ? fmtH(e.holidayHours) : "—"}
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums ${e.overtimeHours ? "text-orange" : "text-ink-faint"}`}>
                        {e.overtimeHours ? fmtH(e.overtimeHours) : "—"}
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-soft">{absenceParts.length ? absenceParts.join(" · ") : <span className="text-ink-faint">—</span>}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${e.fixAmount !== null ? "text-ink" : "text-ink-faint"}`}>{fmtEurOrDashMasked(e.fixAmount, canSeeWages)}</td>
                      <td className={`px-3 py-3 text-right tabular-nums ${e.variableAmount !== null ? "text-ink" : "text-ink-faint"}`}>{fmtEurOrDashMasked(e.variableAmount, canSeeWages)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{fmtEurMasked(e.grossWage, canSeeWages)}</td>
                      <td className="px-3 py-3 text-right">
                        <ExportLink
                          href={pdfEmployeeHref(e.employeeId)}
                          title="Výkaz PDF"
                          className="inline-flex items-center justify-center rounded-md p-1.5 text-ink-faint transition hover:bg-cream-2 hover:text-ink"
                        >
                          <FileText size={15} />
                        </ExportLink>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-cream-2 font-semibold text-ink">
                  <td className="sticky left-0 z-[1] border-r border-line bg-cream-2 px-4 py-3">Spolu ({summary.employees.length} zam.)</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtH(summary.totals.workedHours)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtH(summary.totals.holidayHours)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtH(summary.totals.overtimeHours)}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtEurMasked(summary.totals.fixAmount, canSeeWages)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtEurMasked(summary.totals.variableAmount, canSeeWages)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{canSeeWages ? fmtEur(summary.totals.grossWage) : HIDDEN_AMOUNT}</td>
                  <td className="px-3 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {summary.employees.length === 0 && (
            <div className="rounded-[14px] border border-line bg-paper p-6 text-center text-sm text-ink-soft shadow-sm">
              Žiadni zamestnanci v tejto prevádzke počas vybraného obdobia.
            </div>
          )}

          <p className="flex items-center gap-2 text-xs text-ink-faint">
            Excel obsahuje rozpis odpracovaných hodín (sviatok, nadčas) a neprítomnosti v hodinách — priamo na zaslanie účtovníčke. Príplatky systém zámerne nepočíta. Evidencia podľa §99 Zákonníka práce.
          </p>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, meta, accent }: { label: string; value: string; meta: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4 shadow-sm">
      <div className="text-xs font-semibold text-ink-faint">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${accent ? "text-sage-dark" : "text-ink"}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-faint">{meta}</div>
    </div>
  );
}

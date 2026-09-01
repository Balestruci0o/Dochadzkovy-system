import { Document, Page, Text, View } from "@react-pdf/renderer";
import { ABSENCE_KIND_CONFIG } from "@/components/calendar/absence-kinds";
import { WEEKDAYS } from "@/lib/shared/weekdays";
import { isoWeekday, monthLabel } from "@/lib/shared/dates";
import type { DailyRow } from "../daily-rows";
import { absenceDaysToHours, REPORTED_ABSENCE_KINDS, type EmployeeMonthlySummary, type MonthlySummary } from "../monthly-summary";
import { ensureFontsRegistered } from "./fonts";
import { GlyphPrimer } from "./glyph-primer";
import { ReportHead } from "./report-head";
import { styles } from "./styles";

const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  done: "Odpracované",
  working: "Prebieha",
  planned: "Naplánované",
  auto_closed: "Auto-uzavreté",
};

function fmtH(n: number): string {
  return `${n.toFixed(1).replace(".", ",")} h`;
}
function fmtEur(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}
const HIDDEN_AMOUNT = "•••";
/**
 * Fáza 4 (Mzdy) — "•••" LEN keď je za tým SKUTOČNÉ číslo, čo viewer nesmie
 * vidieť. `null` (hodinový zamestnanec nemá fix/variabilnú vôbec, nie je čo
 * skrývať) ostáva "—" bez ohľadu na canViewWages — inak by "•••" klamlivo
 * naznačovalo skrytú sumu tam, kde žiadna neexistuje.
 */
function fmtEurOrDashMasked(n: number | null, canViewWages: boolean): string {
  if (n === null) return "—";
  return canViewWages ? fmtEur(n) : HIDDEN_AMOUNT;
}
function fmtEurMasked(n: number, canViewWages: boolean): string {
  return canViewWages ? fmtEur(n) : HIDDEN_AMOUNT;
}
function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("sk-SK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bratislava" }).format(d);
}
function fmtDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d}.${m}.${y}`;
}
function rowStatusLabel(row: DailyRow): string {
  if (row.isAbsence && row.absenceKind) return ABSENCE_KIND_CONFIG[row.absenceKind].label;
  return ATTENDANCE_STATUS_LABELS[row.status] ?? row.status;
}

/**
 * Blok 12, bod 2 — PDF výkaz JEDNÉHO zamestnanca. Rovnaké čísla ako mesačný
 * prehľad/Excel (#81/#83) — žiadny nový výpočet, len iné zobrazenie tých
 * istých agregátov + denná evidencia (tú Excel/prehľad nepotrebujú, PDF pre
 * jedného človeka áno).
 *
 * Vizuál zámerne nedoladený — len rozloženie/paleta, presnú podobu tlačiva
 * si každá firma prispôsobí vlastnému vzoru.
 */
export function EmployeeReportDocument({
  orgName,
  ico,
  summary,
  employee,
  dailyRows,
  canViewWages,
}: {
  orgName: string;
  ico: string | null;
  summary: MonthlySummary;
  employee: EmployeeMonthlySummary;
  dailyRows: DailyRow[];
  canViewWages: boolean;
}) {
  return (
    <Document>
      <EmployeeReportPage orgName={orgName} ico={ico} summary={summary} employee={employee} dailyRows={dailyRows} canViewWages={canViewWages} />
    </Document>
  );
}

/**
 * Samotná stránka BEZ `<Document>` obálky — vyňaté, aby ju hromadný "výpisy
 * všetkých" PDF (`renderAllEmployeesIndividualPdf`) mohol poskladať viackrát
 * za sebou do JEDNÉHO `<Document>` (viac `<Page>` v jednom súbore), presne
 * ako keby si vytlačil jednotlivé výpisy všetkých naraz. `EmployeeReportDocument`
 * (jednotlivý výpis) je odteraz len tenký wrapper okolo tejto stránky.
 */
export function EmployeeReportPage({
  orgName,
  ico,
  summary,
  employee,
  dailyRows,
  canViewWages,
}: {
  orgName: string;
  ico: string | null;
  summary: MonthlySummary;
  employee: EmployeeMonthlySummary;
  dailyRows: DailyRow[];
  canViewWages: boolean;
}) {
  ensureFontsRegistered();
  const rowsToShow = dailyRows.filter((r) => r.isAbsence || r.workedHours > 0 || r.overtimeHours > 0 || r.actualStart);

  return (
      <Page size="A4" style={styles.page}>
        <GlyphPrimer />
        <ReportHead orgName={orgName} ico={ico} />

        <Text style={styles.title}>Výkaz dochádzky</Text>
        <Text style={styles.subtitle}>
          {employee.name}
          {employee.positionName ? ` · ${employee.positionName}` : ""}
          {employee.personalNumber ? ` · os. č. ${employee.personalNumber}` : ""} · {summary.workplaceName} · obdobie {monthLabel(summary.year, summary.month)}
        </Text>

        <View style={styles.infoRow}>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Odpracované hodiny</Text>
            <Text style={styles.infoValue}>{fmtH(employee.workedHours)}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Meškania</Text>
            <Text style={styles.infoValue}>{employee.lateCount}×</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Fix</Text>
            <Text style={styles.infoValue}>{fmtEurOrDashMasked(employee.fixAmount, canViewWages)}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Variabilná</Text>
            <Text style={styles.infoValue}>{fmtEurOrDashMasked(employee.variableAmount, canViewWages)}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Hrubá mzda</Text>
            <Text style={styles.infoValue}>{fmtEurMasked(employee.grossWage, canViewWages)}</Text>
          </View>
        </View>

        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.sectionHeading}>Rozpis odpracovaných hodín</Text>
            <View style={styles.miniRow}>
              <Text style={styles.miniLabel}>Odpracované spolu</Text>
              <Text style={styles.miniValue}>{fmtH(employee.workedHours)}</Text>
            </View>
            <View style={styles.miniRow}>
              <Text style={styles.miniLabel}>z toho sviatok</Text>
              <Text style={styles.miniValue}>{fmtH(employee.holidayHours)}</Text>
            </View>
            <View style={styles.miniRow}>
              <Text style={styles.miniLabel}>Nadčas</Text>
              <Text style={styles.miniValue}>{fmtH(employee.overtimeHours)}</Text>
            </View>
          </View>

          <View style={styles.col}>
            <Text style={styles.sectionHeading}>Neprítomnosť</Text>
            {REPORTED_ABSENCE_KINDS.map((k) => (
              <View style={styles.miniRow} key={k}>
                <Text style={styles.miniLabel}>{ABSENCE_KIND_CONFIG[k].label}</Text>
                <Text style={styles.miniValue}>{fmtH(absenceDaysToHours(employee.absenceDays[k]))}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.sectionHeading}>Denná evidencia</Text>
        <View style={styles.table}>
          <View style={styles.trHead} fixed>
            <Text style={[styles.th, { width: "13%" }]}>Dátum</Text>
            <Text style={[styles.th, { width: "10%" }]}>Deň</Text>
            <Text style={[styles.th, { width: "14%" }]}>Príchod</Text>
            <Text style={[styles.th, { width: "14%" }]}>Odchod</Text>
            <Text style={[styles.th, { width: "13%" }]}>Prest.</Text>
            <Text style={[styles.th, styles.right, { width: "13%" }]}>Hodiny</Text>
            <Text style={[styles.th, { width: "23%" }]}>Stav</Text>
          </View>
          {rowsToShow.map((row) => (
            <View style={styles.tr} key={row.date} wrap={false}>
              <Text style={[styles.td, { width: "13%" }]}>{fmtDate(row.date)}</Text>
              <Text style={[styles.td, { width: "10%" }]}>{WEEKDAYS[isoWeekday(row.date) - 1].short}</Text>
              <Text style={[styles.td, { width: "14%" }]}>{fmtTime(row.actualStart)}</Text>
              <Text style={[styles.td, { width: "14%" }]}>{fmtTime(row.actualEnd)}</Text>
              <Text style={[styles.td, { width: "13%" }]}>{row.breakMinutes ? `${row.breakMinutes} min` : "—"}</Text>
              <Text style={[styles.td, styles.right, { width: "13%" }]}>{row.workedHours + row.overtimeHours > 0 ? fmtH(row.workedHours + row.overtimeHours) : "—"}</Text>
              <Text style={[styles.td, { width: "23%" }]}>{rowStatusLabel(row)}</Text>
            </View>
          ))}
          <View style={styles.trTotal}>
            <Text style={[styles.td, { width: "64%", fontWeight: "bold" }]}>Spolu odpracované</Text>
            <Text style={[styles.td, styles.right, { width: "13%", fontWeight: "bold" }]}>{fmtH(employee.workedHours + employee.overtimeHours)}</Text>
            <Text style={[styles.td, { width: "23%" }]}></Text>
          </View>
        </View>

        <Text style={styles.legal}>
          Evidencia pracovného času podľa §99 Zákonníka práce. Dovolenka §100–117 · PN/OČR §141 · prekážky v práci §136–141 · práca nadčas §97, vo sviatok §122, nočná práca §123. Príplatky sa do tohto výkazu nepočítajú.
        </Text>

        <View style={styles.foot}>
          <Text>
            Meškania: {employee.lateCount}× · Hrubá mzda: {fmtEurMasked(employee.grossWage, canViewWages)}
          </Text>
          <Text style={styles.signLine}>Podpis zodpovednej osoby</Text>
        </View>
      </Page>
  );
}

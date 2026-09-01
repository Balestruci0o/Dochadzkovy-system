import { Document, Page, Text, View } from "@react-pdf/renderer";
import { monthLabel } from "@/lib/shared/dates";
import { absenceDaysToHours, REPORTED_ABSENCE_KINDS, type MonthlySummary } from "../monthly-summary";
import { ensureFontsRegistered } from "./fonts";
import { GlyphPrimer } from "./glyph-primer";
import { ReportHead } from "./report-head";
import { styles } from "./styles";

const ABSENCE_SHORT: Record<string, string> = { dovolenka: "D", pn: "PN", ocr: "OČR", paragraf: "P", neplatene: "NV" };

function fmtH(n: number): string {
  return n ? n.toFixed(1).replace(".", ",") : "—";
}
function fmtEur(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}
function fmtEurOrDash(n: number | null): string {
  return n === null ? "—" : fmtEur(n);
}
const HIDDEN_AMOUNT = "•••";
/** Fáza 4 (Mzdy) — "•••" LEN keď je za tým skutočné číslo (viď rovnaká funkcia v employee-document.tsx). */
function fmtEurOrDashMasked(n: number | null, canViewWages: boolean): string {
  if (n === null) return "—";
  return canViewWages ? fmtEur(n) : HIDDEN_AMOUNT;
}
function fmtEurMasked(n: number, canViewWages: boolean): string {
  return canViewWages ? fmtEur(n) : HIDDEN_AMOUNT;
}

const COLS = [
  { key: "name", label: "Zamestnanec", width: "15%" },
  { key: "position", label: "Pozícia", width: "9%" },
  { key: "worked", label: "Odprac. (h)", width: "7%", right: true },
  { key: "holiday", label: "Sviat. (h)", width: "6%", right: true },
  { key: "overtime", label: "Nadč. (h)", width: "6%", right: true },
  ...REPORTED_ABSENCE_KINDS.map((k) => ({ key: `abs_${k}`, label: `${ABSENCE_SHORT[k]} (h)`, width: "5%", right: true })),
  { key: "fix", label: "Fix (€)", width: "8%", right: true },
  { key: "variable", label: "Variabilná (€)", width: "9%", right: true },
  { key: "wage", label: "Hrubá mzda", width: "13%", right: true },
];

/**
 * Blok 12, bod 3 — hromadný PDF prehľad prevádzky. Landscape — veľa stĺpcov.
 * Rovnaké čísla ako Excel/mesačný prehľad, žiadny nový výpočet.
 */
export function SummaryReportDocument({
  orgName,
  ico,
  summary,
  canViewWages,
}: {
  orgName: string;
  ico: string | null;
  summary: MonthlySummary;
  canViewWages: boolean;
}) {
  ensureFontsRegistered();

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.pageWide}>
        <GlyphPrimer />
        <ReportHead orgName={orgName} ico={ico} />
        <Text style={styles.title}>Mesačný výkaz dochádzky — prehľad prevádzky</Text>
        <Text style={styles.subtitle}>
          {summary.workplaceName} · obdobie {monthLabel(summary.year, summary.month)} · {summary.employees.length} zamestnancov · mzdový podklad
        </Text>

        <View style={styles.table}>
          <View style={styles.trHead} fixed>
            {COLS.map((c) => (
              <Text key={c.key} style={[styles.th, c.right ? styles.right : {}, { width: c.width }]}>
                {c.label}
              </Text>
            ))}
          </View>
          {summary.employees.map((e) => (
            <View style={styles.tr} key={e.employeeId} wrap={false}>
              <Text style={[styles.td, { width: "15%" }]}>{e.name}</Text>
              <Text style={[styles.td, { width: "9%" }]}>{e.positionName ?? "—"}</Text>
              <Text style={[styles.td, styles.right, { width: "7%", fontWeight: "bold" }]}>{fmtH(e.workedHours)}</Text>
              <Text style={[styles.td, styles.right, { width: "6%" }]}>{fmtH(e.holidayHours)}</Text>
              <Text style={[styles.td, styles.right, { width: "6%" }]}>{fmtH(e.overtimeHours)}</Text>
              {REPORTED_ABSENCE_KINDS.map((k) => (
                <Text key={k} style={[styles.td, styles.right, { width: "5%" }]}>
                  {fmtH(absenceDaysToHours(e.absenceDays[k]))}
                </Text>
              ))}
              <Text style={[styles.td, styles.right, { width: "8%" }]}>{fmtEurOrDashMasked(e.fixAmount, canViewWages)}</Text>
              <Text style={[styles.td, styles.right, { width: "9%" }]}>{fmtEurOrDashMasked(e.variableAmount, canViewWages)}</Text>
              <Text style={[styles.td, styles.right, { width: "13%", fontWeight: "bold" }]}>{fmtEurMasked(e.grossWage, canViewWages)}</Text>
            </View>
          ))}
          <View style={styles.trTotal}>
            <Text style={[styles.td, { width: "24%", fontWeight: "bold" }]}>Spolu ({summary.employees.length})</Text>
            <Text style={[styles.td, styles.right, { width: "7%", fontWeight: "bold" }]}>{fmtH(summary.totals.workedHours)}</Text>
            <Text style={[styles.td, styles.right, { width: "6%", fontWeight: "bold" }]}>{fmtH(summary.totals.holidayHours)}</Text>
            <Text style={[styles.td, styles.right, { width: "6%", fontWeight: "bold" }]}>{fmtH(summary.totals.overtimeHours)}</Text>
            {REPORTED_ABSENCE_KINDS.map((k) => (
              <Text key={k} style={[styles.td, styles.right, { width: "5%", fontWeight: "bold" }]}>
                {fmtH(absenceDaysToHours(summary.totals.absenceDays[k]))}
              </Text>
            ))}
            <Text style={[styles.td, styles.right, { width: "8%", fontWeight: "bold" }]}>{fmtEurMasked(summary.totals.fixAmount, canViewWages)}</Text>
            <Text style={[styles.td, styles.right, { width: "9%", fontWeight: "bold" }]}>{fmtEurMasked(summary.totals.variableAmount, canViewWages)}</Text>
            <Text style={[styles.td, styles.right, { width: "13%", fontWeight: "bold" }]}>{fmtEurMasked(summary.totals.grossWage, canViewWages)}</Text>
          </View>
        </View>

        <Text style={styles.legal}>
          Vysvetlivky: D — dovolenka · PN — práceneschopnosť · OČR — ošetrovanie člena rodiny · P — paragraf/lekár · NV — neplatené voľno. Absencie sú v hodinách (8 h = 1 deň). Sviatok = odpracované hodiny vo sviatok (podklad pre príplatok §122). Evidencia podľa §99 Zákonníka práce.
        </Text>

        <View style={styles.foot}>
          <Text>Spolu hrubé mzdy: {fmtEurMasked(summary.totals.grossWage, canViewWages)}</Text>
          <Text style={styles.signLine}>Podpis zodpovednej osoby</Text>
        </View>
      </Page>
    </Document>
  );
}

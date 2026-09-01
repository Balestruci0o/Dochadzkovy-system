import ExcelJS from "exceljs";
import { monthLabel } from "@/lib/shared/dates";
import { absenceDaysToHours, REPORTED_ABSENCE_KINDS, type AbsenceKind, type MonthlySummary } from "./monthly-summary";

// Kompletný Record<AbsenceKind,...> (typová požiadavka), aj keď sa
// `nahradne_volno` vo výkaze nevypisuje — REPORTED_ABSENCE_KINDS nižšie ho
// z iterácie vynecháva.
const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  dovolenka: "Dovolenka (h)",
  pn: "PN (h)",
  ocr: "OČR (h)",
  paragraf: "Paragraf (h)",
  neplatene: "Neplatené (h)",
  nahradne_volno: "Náhr. voľno (h)",
};

/**
 * Blok 12, bod 4 — hromadný Excel pre účtovníčku. Zámerne ČISTÁ tabuľka
 * čísel (žiadne logo/farby/rozloženie — na rozdiel od PDF, kde príde vzor
 * od klienta) — presne stĺpce z mesačného prehľadu (`monthly-summary.ts`),
 * nič sa tu neprepočítava naново. Sadzba je PER DEŇ (`getRateAt`) už v
 * `grossWage` — Excel samotný žiadnu sadzbu neuvidí/neprepočítava.
 */
const HIDDEN_AMOUNT = "•••";

/**
 * Fáza 4 (Mzdy) — `canViewWages=false` znamená viewer nemá `view_wages`
 * (RLS mu aj tak nevráti sadzby/plat, `summary`'s peňažné polia by boli
 * ticho 0/null) — nahradí PEŇAŽNÉ bunky (nie hodiny) reťazcom "•••", aby to
 * nevyzeralo ako chyba dát. Číselný formát stĺpca sa na reťazcovú bunku
 * jednoducho neaplikuje — Excel ju zobrazí ako čistý text, čo je zámer.
 */
/** "•••" LEN keď je za tým skutočné číslo — `null` (napr. hodinový nemá fix) ostáva prázdna bunka, nie "•••". */
function maskAmountOrNull(n: number | null, canViewWages: boolean): number | string | null {
  if (n === null) return null;
  return canViewWages ? n : HIDDEN_AMOUNT;
}
function maskAmount(n: number, canViewWages: boolean): number | string {
  return canViewWages ? n : HIDDEN_AMOUNT;
}

export async function buildMonthlyExcel(summary: MonthlySummary, canViewWages: boolean): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dochádzka TD";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(`${monthLabel(summary.year, summary.month)} — ${summary.workplaceName}`);

  sheet.columns = [
    { header: "Zamestnanec", key: "name", width: 24 },
    { header: "Os. číslo", key: "personalNumber", width: 12 },
    { header: "Odprac. hodiny", key: "workedHours", width: 14 },
    { header: "Sviatok (h)", key: "holidayHours", width: 12 },
    { header: "Nadčas (h)", key: "overtimeHours", width: 12 },
    { header: "Meškania (x)", key: "lateCount", width: 12 },
    ...REPORTED_ABSENCE_KINDS.map((k) => ({ header: ABSENCE_LABELS[k], key: `abs_${k}`, width: 14 })),
    { header: "Fix (€)", key: "fixAmount", width: 14 },
    { header: "Variabilná (€)", key: "variableAmount", width: 14 },
    { header: "Hrubá mzda (€)", key: "grossWage", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const hourCols = ["workedHours", "holidayHours", "overtimeHours", ...REPORTED_ABSENCE_KINDS.map((k) => `abs_${k}`)];
  for (const key of hourCols) {
    const col = sheet.getColumn(key);
    col.numFmt = "0.00";
  }
  sheet.getColumn("fixAmount").numFmt = '#,##0.00 "€"';
  sheet.getColumn("variableAmount").numFmt = '#,##0.00 "€"';
  sheet.getColumn("grossWage").numFmt = '#,##0.00 "€"';

  for (const e of summary.employees) {
    const row: Record<string, unknown> = {
      name: e.name,
      personalNumber: e.personalNumber ?? "",
      workedHours: e.workedHours,
      holidayHours: e.holidayHours,
      overtimeHours: e.overtimeHours,
      lateCount: e.lateCount,
      // Fixný plat, Fáza 4 — hodinovým (aj fixným bez založenej histórie)
      // ostáva bunka PRÁZDNA (null), nie "0 €" — to by predstieralo záznam,
      // ktorý neexistuje. Mzdy, Fáza 4 — "•••" namiesto skutočnej sumy, keď
      // viewer nemá view_wages (kozmetika, bezpečnosť drží RLS).
      fixAmount: maskAmountOrNull(e.fixAmount, canViewWages),
      variableAmount: maskAmountOrNull(e.variableAmount, canViewWages),
      grossWage: maskAmount(e.grossWage, canViewWages),
    };
    for (const k of REPORTED_ABSENCE_KINDS) row[`abs_${k}`] = absenceDaysToHours(e.absenceDays[k]);
    sheet.addRow(row);
  }

  const totalsRow: Record<string, unknown> = {
    name: `Spolu (${summary.employees.length} zam.)`,
    workedHours: summary.totals.workedHours,
    holidayHours: summary.totals.holidayHours,
    overtimeHours: summary.totals.overtimeHours,
    fixAmount: maskAmount(summary.totals.fixAmount, canViewWages),
    variableAmount: maskAmount(summary.totals.variableAmount, canViewWages),
    grossWage: maskAmount(summary.totals.grossWage, canViewWages),
  };
  for (const k of REPORTED_ABSENCE_KINDS) totalsRow[`abs_${k}`] = absenceDaysToHours(summary.totals.absenceDays[k]);
  const tr = sheet.addRow(totalsRow);
  tr.font = { bold: true };
  tr.border = { top: { style: "thin" } };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

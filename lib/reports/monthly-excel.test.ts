import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { MonthlySummary } from "./monthly-summary";
import { buildMonthlyExcel } from "./monthly-excel";

/**
 * Blok 12, bod 4 — over, že Excel NIE JE len "nespadlo", ale že bunky
 * reálne obsahujú správne čísla (načíta sa vygenerovaný .xlsx späť cez
 * ExcelJS a číta konkrétne bunky, presne ako by to spravila účtovníčka).
 *
 * Nočné/víkendové hodiny, náhradné voľno a dovolenka nárok/čerpané/zostatok
 * boli z výkazov ÚPLNE odstránené (predtým to bolo zadané, ale neaplikovalo
 * sa vo všetkých 4 výstupoch) — negatívne assercie nižšie sú regresný test
 * PRESNE na to, aby sa to nabudúce nestratilo.
 */

function sampleSummary(): MonthlySummary {
  return {
    workplaceId: "wp-1",
    workplaceName: "Hotel",
    year: 2027,
    month: 3,
    employees: [
      {
        employeeId: "e1",
        name: "Plná Mzda",
        personalNumber: "E001",
        positionName: "Recepcia",
        payMode: "hodinovy",
        daysWorked: 4,
        workedHours: 32,
        overtimeHours: 1,
        weekendHours: 8,
        holidayHours: 2,
        nightHours: 7.5,
        lateCount: 1,
        lateMinutesTotal: 10,
        absenceDays: { dovolenka: 2, pn: 1, ocr: 0, paragraf: 0, neplatene: 0, nahradne_volno: 3 },
        vacation: { entitlement: 20, taken: 3, remaining: 17 },
        grossWage: 362,
        fixAmount: null,
        variableAmount: null,
      },
      {
        employeeId: "e2",
        name: "Druhý Zamestnanec",
        personalNumber: null,
        positionName: "Kuchár",
        payMode: "hodinovy",
        daysWorked: 2,
        workedHours: 16,
        overtimeHours: 0,
        weekendHours: 0,
        holidayHours: 0,
        nightHours: 0,
        lateCount: 0,
        lateMinutesTotal: 0,
        absenceDays: { dovolenka: 0, pn: 0, ocr: 0, paragraf: 0, neplatene: 0, nahradne_volno: 0 },
        vacation: { entitlement: 20, taken: 0, remaining: 20 },
        grossWage: 128,
        fixAmount: null,
        variableAmount: null,
      },
    ],
    totals: {
      daysWorked: 6,
      workedHours: 48,
      overtimeHours: 1,
      weekendHours: 8,
      holidayHours: 2,
      nightHours: 7.5,
      absenceDays: { dovolenka: 2, pn: 1, ocr: 0, paragraf: 0, neplatene: 0, nahradne_volno: 3 },
      grossWage: 490,
      fixAmount: 0,
      variableAmount: 0,
    },
  };
}

function sampleSummaryWithFixedEmployee(): MonthlySummary {
  const base = sampleSummary();
  return {
    ...base,
    employees: [
      ...base.employees,
      {
        employeeId: "e3",
        name: "Fixný Plat",
        personalNumber: "E003",
        positionName: "Recepcia",
        payMode: "fixny",
        daysWorked: 3,
        workedHours: 24,
        overtimeHours: 0,
        weekendHours: 0,
        holidayHours: 0,
        nightHours: 0,
        lateCount: 0,
        lateMinutesTotal: 0,
        absenceDays: { dovolenka: 0, pn: 0, ocr: 0, paragraf: 0, neplatene: 0, nahradne_volno: 0 },
        vacation: { entitlement: 20, taken: 0, remaining: 20 },
        grossWage: 1000,
        fixAmount: 900,
        variableAmount: 100,
      },
    ],
    totals: {
      ...base.totals,
      workedHours: base.totals.workedHours + 24,
      grossWage: base.totals.grossWage + 1000,
      fixAmount: 900,
      variableAmount: 100,
    },
  };
}

describe("buildMonthlyExcel — bunky obsahujú SPRÁVNE čísla, nie len 'nespadlo'", () => {
  it("hlavička, riadky zamestnancov aj riadok Spolu majú presné hodnoty po spätnom načítaní", async () => {
    const buf = await buildMonthlyExcel(sampleSummary(), true);
    expect(buf.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    // Cast: @types/node verzia bundlovaná v exceljs vs. projektová sa rozchádzajú v tvare `Buffer` (runtime je to to isté).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- len typová nekompatibilita medzi verziami @types/node, nie runtime problém
    await workbook.xlsx.load(buf as any);
    const sheet = workbook.worksheets[0];
    expect(sheet.name).toContain("Marec 2027");
    expect(sheet.name).toContain("Hotel");

    const header = sheet.getRow(1).values as unknown[];
    expect(header).toContain("Zamestnanec");
    expect(header).toContain("Sviatok (h)");
    expect(header).toContain("Dovolenka (h)");
    expect(header).toContain("Hrubá mzda (€)");

    // Regresia — tieto stĺpce boli z výkazov odstránené, nesmú sa vrátiť.
    expect(header).not.toContain("Odprac. dni");
    expect(header).not.toContain("Nočné (h)");
    expect(header).not.toContain("Víkend (h)");
    expect(header).not.toContain("Dovolenka nárok");
    expect(header).not.toContain("Dovolenka čerpané");
    expect(header).not.toContain("Dovolenka zostatok");
    expect(header).not.toContain("Náhr. voľno (h)");
    expect(header.some((h) => typeof h === "string" && h.includes("dni"))).toBe(false);

    const row1 = sheet.getRow(2).values as unknown[];
    // ExcelJS .values je 1-indexované pole (index 0 je prázdny) — stĺpce presne v poradí columns[]:
    // Zamestnanec, Os. číslo, Odprac. hodiny, Sviatok (h), Nadčas (h), Meškania (x), Dovolenka (h), PN (h), OČR (h), Paragraf (h), Neplatené (h), Hrubá mzda (€).
    expect(row1[1]).toBe("Plná Mzda");
    expect(row1[2]).toBe("E001");
    expect(row1[3]).toBe(32); // odprac. hodiny
    expect(row1[4]).toBe(2); // sviatok
    expect(row1[5]).toBe(1); // nadčas
    expect(row1[7]).toBe(16); // dovolenka: 2 dni × 8h = 16h

    const row2 = sheet.getRow(3).values as unknown[];
    expect(row2[1]).toBe("Druhý Zamestnanec");
    expect(row2[2]).toBe(""); // bez os. čísla → prázdne, nie "null"

    const totalsRow = sheet.getRow(4).values as unknown[];
    expect(totalsRow[1]).toBe("Spolu (2 zam.)");
    expect(totalsRow[3]).toBe(48); // súčet odprac. hodín

    // Hrubá mzda je posledný stĺpec — over presnú hodnotu (nie len že existuje).
    const lastCol = sheet.columns.length;
    expect(row1[lastCol]).toBeCloseTo(362, 6);
    expect(totalsRow[lastCol]).toBeCloseTo(490, 6);

    // Bold hlavička aj Spolu riadok (vizuálne odlíšenie súčtu, aj keď je to "len tabuľka čísel").
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getRow(4).font?.bold).toBe(true);
  });

  it("Fix/Variabilná stĺpce — fixný má hodnoty ZVLÁŠŤ, hodinový má prázdne bunky (nie 0)", async () => {
    const buf = await buildMonthlyExcel(sampleSummaryWithFixedEmployee(), true);
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viď komentár vyššie v súbore
    await workbook.xlsx.load(buf as any);
    const sheet = workbook.worksheets[0];

    const header = sheet.getRow(1).values as unknown[];
    expect(header).toContain("Fix (€)");
    expect(header).toContain("Variabilná (€)");

    const fixCol = header.indexOf("Fix (€)");
    const varCol = header.indexOf("Variabilná (€)");
    const wageCol = header.indexOf("Hrubá mzda (€)");

    const rowHourly = sheet.getRow(2).values as unknown[]; // Plná Mzda — hodinový
    expect(rowHourly[fixCol] ?? null).toBeNull();
    expect(rowHourly[varCol] ?? null).toBeNull();
    expect(rowHourly[wageCol]).toBeCloseTo(362, 6);

    const rowFixed = sheet.getRow(4).values as unknown[]; // Fixný Plat — 3. zamestnanec, 3. dátový riadok
    expect(rowFixed[1]).toBe("Fixný Plat");
    expect(rowFixed[fixCol]).toBeCloseTo(900, 6);
    expect(rowFixed[varCol]).toBeCloseTo(100, 6);
    expect(rowFixed[wageCol]).toBeCloseTo(1000, 6); // 900 + 100, súčet

    const totalsRow = sheet.getRow(5).values as unknown[];
    expect(totalsRow[fixCol]).toBeCloseTo(900, 6);
    expect(totalsRow[varCol]).toBeCloseTo(100, 6);
    expect(totalsRow[wageCol]).toBeCloseTo(1490, 6); // 362 + 128 + 1000
  });

  it("Fáza 4 (Mzdy) — canViewWages=false: '•••' namiesto SKUTOČNÝCH súm, hodinový (null) ostáva PRÁZDNY (nie '•••')", async () => {
    const buf = await buildMonthlyExcel(sampleSummaryWithFixedEmployee(), false);
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viď komentár vyššie v súbore
    await workbook.xlsx.load(buf as any);
    const sheet = workbook.worksheets[0];

    const header = sheet.getRow(1).values as unknown[];
    const fixCol = header.indexOf("Fix (€)");
    const varCol = header.indexOf("Variabilná (€)");
    const wageCol = header.indexOf("Hrubá mzda (€)");

    // Hodinový — fix/variabilná NEAPLIKOVATEĽNÉ, ostávajú prázdne (null), nie "•••".
    const rowHourly = sheet.getRow(2).values as unknown[];
    expect(rowHourly[fixCol] ?? null).toBeNull();
    expect(rowHourly[varCol] ?? null).toBeNull();
    expect(rowHourly[wageCol]).toBe("•••"); // SKUTOČNÁ suma (362) sa nesmie objaviť

    // Fixný — SKUTOČNÉ sumy existujú, musia byť maskované.
    const rowFixed = sheet.getRow(4).values as unknown[];
    expect(rowFixed[fixCol]).toBe("•••");
    expect(rowFixed[varCol]).toBe("•••");
    expect(rowFixed[wageCol]).toBe("•••");

    const totalsRow = sheet.getRow(5).values as unknown[];
    expect(totalsRow[fixCol]).toBe("•••");
    expect(totalsRow[varCol]).toBe("•••");
    expect(totalsRow[wageCol]).toBe("•••");

    // Nikde v celom hárku sa nesmie objaviť ŽIADNA zo SKUTOČNÝCH súm.
    const allValues = [1, 2, 3, 4, 5].flatMap((r) => sheet.getRow(r).values as unknown[]);
    expect(allValues).not.toContain(362);
    expect(allValues).not.toContain(900);
    expect(allValues).not.toContain(100);
    expect(allValues).not.toContain(1000);
    expect(allValues).not.toContain(1490);
  });
});

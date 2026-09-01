import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- testovacia fixtúra zakladá org/zamestnancov priamo, mimo bežného app.user_id toku
import { adminDb } from "@/lib/db/admin";
import { attendanceDays, employeePositionHistory, employeeRateHistory, employeeSalaryHistory, employees, employeeWorkplaces, organizations, positions, workplaces } from "@/lib/db/schema";
import { deleteOrgCascade } from "@/lib/db/test-fixture";
import { renderAllEmployeesIndividualPdf, renderEmployeePdf, renderSummaryPdf } from "./render";

/**
 * Blok 12, body 2-3 — PDF výkazy. Nájdený reálny bug (nie v našom kóde, ale
 * vo fontkit/@react-pdf/renderer subsetovaní): PRVÝ výskyt
 * niektorých glyfov v tučnom reze v konkrétnom dokumente sa vedel v PDF
 * strate (viditeľne chýbajúce písmeno) — opravené `GlyphPrimer`
 * (neviditeľný "zahrievací" text so všetkými znakmi na začiatku dokumentu).
 * Tieto testy čítajú SKUTOČNÝ vygenerovaný PDF text späť (`pdfjs-dist`),
 * nie len že sa render nezrúti — presne to, čo pri manuálnom ladení
 * odhalilo bug, čo `renderToBuffer` samo o sebe nechytí.
 */

async function extractText(buf: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join("");
  }
  return text;
}

let orgId: string;
let workplaceId: string;
let employeeId: string;
let secondEmployeeId: string;
let fixedEmployeeId: string;

beforeAll(async () => {
  const [org] = await adminDb.insert(organizations).values({ name: `PDF report test org ${crypto.randomUUID()}`, ico: "12345678" }).returning();
  orgId = org.id;
  const [wp] = await adminDb.insert(workplaces).values({ orgId, name: "Hotel", code: "HOTEL" }).returning();
  workplaceId = wp.id;
  const [position] = await adminDb.insert(positions).values({ orgId, workplaceId, name: "Recepcia" }).returning();

  const [employee] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Testovacia", lastName: "Osoba", personalNumber: "E999", hiredOn: "2024-01-01" })
    .returning();
  employeeId = employee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId, workplaceId });
  await adminDb.insert(employeePositionHistory).values({ employeeId, positionId: position.id, validFrom: "2024-01-01" });
  await adminDb.insert(employeeRateHistory).values({ employeeId, hourlyRate: "10.0000", validFrom: "2024-01-01", validTo: null });

  await adminDb.insert(attendanceDays).values({
    employeeId,
    workplaceId,
    date: "2027-05-10",
    workedHours: "8.000",
    overtimeHours: "0",
    weekendHours: "0",
    holidayHours: "0",
    nightHours: "0",
    status: "done",
  });

  // Druhý zamestnanec — len pre renderAllEmployeesIndividualPdf nižšie
  // (over, že hromadný PDF naozaj obsahuje VIACERO ľudí, nie len prvého).
  const [secondEmployee] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Iná", lastName: "Osoba", personalNumber: "E998", hiredOn: "2024-01-01" })
    .returning();
  secondEmployeeId = secondEmployee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: secondEmployeeId, workplaceId });
  await adminDb.insert(employeeRateHistory).values({ employeeId: secondEmployeeId, hourlyRate: "9.0000", validFrom: "2024-01-01", validTo: null });
  await adminDb.insert(attendanceDays).values({
    employeeId: secondEmployeeId,
    workplaceId,
    date: "2027-05-11",
    workedHours: "6.000",
    overtimeHours: "0",
    weekendHours: "0",
    holidayHours: "0",
    nightHours: "0",
    status: "done",
  });

  // Fixný plat (override na zamestnancovi) — Fáza 4, exporty musia ukázať
  // Fix/Variabilná ZVLÁŠŤ pre tohto človeka, "—" pre hodinových vyššie.
  const [fixedEmployee] = await adminDb
    .insert(employees)
    .values({ orgId, firstName: "Fixný", lastName: "Plat", personalNumber: "E997", hiredOn: "2024-01-01", overridePayMode: "fixny" })
    .returning();
  fixedEmployeeId = fixedEmployee.id;
  await adminDb.insert(employeeWorkplaces).values({ employeeId: fixedEmployeeId, workplaceId });
  await adminDb.insert(employeePositionHistory).values({ employeeId: fixedEmployeeId, positionId: position.id, validFrom: "2024-01-01" });
  await adminDb.insert(employeeSalaryHistory).values({ employeeId: fixedEmployeeId, fixAmount: "900.00", variableAmount: "100.00", validFrom: "2024-01-01", validTo: null });
  await adminDb.insert(attendanceDays).values({
    employeeId: fixedEmployeeId,
    workplaceId,
    date: "2027-05-12",
    workedHours: "8.000",
    overtimeHours: "0",
    weekendHours: "0",
    holidayHours: "0",
    nightHours: "0",
    status: "done",
  });
});

afterAll(async () => {
  await deleteOrgCascade(orgId);
});

// Nočné/víkendové hodiny, náhradné voľno a dovolenka nárok/čerpané/zostatok
// boli z výkazov ÚPLNE odstránené (predtým to bolo zadané, ale neaplikovalo
// sa vo všetkých 4 výstupoch) — tieto stringy sa v žiadnom PDF nesmú
// objaviť. Čítané zo SKUTOČNÉHO vygenerovaného PDF (nie len že sa
// nezrúti), presne ako zvyšok tohto súboru.
function expectRemovedFieldsAbsent(text: string) {
  expect(text).not.toContain("Odpracované dni");
  expect(text).not.toContain("nočné");
  expect(text).not.toContain("víkend");
  expect(text).not.toContain("Nočné");
  expect(text).not.toContain("Víkend");
  expect(text).not.toContain("nárok");
  expect(text).not.toContain("čerpané");
  expect(text).not.toContain("zostatok");
  expect(text).not.toContain("NáV");
  expect(text).not.toContain("náhradné voľno");
  expect(text).not.toContain("Náhradné voľno");
}

describe("renderEmployeePdf", () => {
  it("obsahuje presné meno, hrubú mzdu (80 EUR = 8h × 10 EUR) a nadpis BEZ straty prvého písmena", async () => {
    const buf = await adminDb.transaction((tx) => renderEmployeePdf(tx, workplaceId, 2027, 5, employeeId, true));
    const text = await extractText(buf);

    expect(text).toContain("Výkaz dochádzky");
    expect(text).toContain("Testovacia Osoba");
    expect(text).toContain("E999");
    expect(text).toContain("80,00 €");
    // Regresný test na nájdený fontkit bug — "V" na začiatku nadpisu sa v inom
    // kontexte (bulk/landscape dokument) reálne strácalo. Presná zhoda reťazca,
    // nie len .toContain("ýkaz"), aby test naozaj chytil chýbajúci prvý znak.
    expect(text).toMatch(/Výkaz dochádzky/);
    expectRemovedFieldsAbsent(text);
  });

  it("hodinový zamestnanec — Fix aj Variabilná sú prázdne ('—'), NIE '0,00 €'", async () => {
    const buf = await adminDb.transaction((tx) => renderEmployeePdf(tx, workplaceId, 2027, 5, employeeId, true));
    const text = await extractText(buf);

    // Labely v PDF majú textTransform:uppercase — extrahovaný text ich vráti VEĽKÝMI.
    // Dash HNEĎ za labelom (žiadne číslo medzi) — dôkaz, že sa nič nepredstiera.
    expect(text).toContain("FIX—");
    expect(text).toContain("VARIABILNÁ—");
  });

  it("fixný zamestnanec — Fix (900,00 €) a Variabilná (100,00 €) ZVLÁŠŤ, hrubá mzda 1000,00 € (súčet), hodiny VIDNO", async () => {
    const buf = await adminDb.transaction((tx) => renderEmployeePdf(tx, workplaceId, 2027, 5, fixedEmployeeId, true));
    const text = await extractText(buf);

    expect(text).toContain("Fixný Plat");
    expect(text).toContain("E997");
    expect(text).toContain("900,00 €");
    expect(text).toContain("100,00 €");
    expect(text).toContain("1000,00 €"); // hrubá mzda = súčet, NIE z hodín
    expect(text).toContain("8,0 h"); // odpracované hodiny — informačne, aj keď mzdu neurčujú
    expectRemovedFieldsAbsent(text);
  });

  it("Fáza 4 (Mzdy) — canViewWages=false: '•••' namiesto SKUTOČNÝCH súm, hodiny OSTÁVAJÚ vidno", async () => {
    const buf = await adminDb.transaction((tx) => renderEmployeePdf(tx, workplaceId, 2027, 5, fixedEmployeeId, false));
    const text = await extractText(buf);

    expect(text).toContain("•••");
    // Žiadna zo SKUTOČNÝCH súm tohto zamestnanca sa nesmie objaviť v texte.
    expect(text).not.toContain("900,00 €");
    expect(text).not.toContain("100,00 €");
    expect(text).not.toContain("1000,00 €");
    // Hodiny sú informačné, view_wages sa ich netýka — musia ostať viditeľné.
    expect(text).toContain("8,0 h");
    expect(text).toContain("Fixný Plat");
  });
});

describe("renderSummaryPdf", () => {
  it("nadpis 'Mesačný výkaz...' je CELÝ (regresný test na nájdený fontkit bug — 'M' sa reálne strácalo)", async () => {
    const buf = await adminDb.transaction((tx) => renderSummaryPdf(tx, workplaceId, 2027, 5, true));
    const text = await extractText(buf);

    // Presná zhoda CELÉHO nadpisu vrátane začiatočného "M" — bug spôsobil práve
    // to, že extrahovaný text začínal "esačný výkaz..." (chýbajúce prvé písmeno).
    expect(text).toContain("Mesačný výkaz dochádzky — prehľad prevádzky");
    expect(text).toContain("Testovacia Osoba");
    expect(text).toContain("80,00 €");
    expectRemovedFieldsAbsent(text);
  });

  it("fixný zamestnanec v súhrnnej tabuľke — Fix/Variabilná stĺpce, hodinoví majú '—'", async () => {
    const buf = await adminDb.transaction((tx) => renderSummaryPdf(tx, workplaceId, 2027, 5, true));
    const text = await extractText(buf);

    expect(text).toContain("FIX (€)");
    expect(text).toContain("VARIABILNÁ (€)");
    expect(text).toContain("Fixný Plat");
    expect(text).toContain("900,00 €");
    expect(text).toContain("100,00 €");
    expect(text).toContain("1000,00 €");
    // Spolu hrubé: 80 (Testovacia) + 54 (Iná) + 1000 (Fixný) = 1134.
    expect(text).toContain("1134,00 €");
  });

  it("Fáza 4 (Mzdy) — canViewWages=false: '•••' namiesto SKUTOČNÝCH súm pre KAŽDÉHO zamestnanca aj v súčte", async () => {
    const buf = await adminDb.transaction((tx) => renderSummaryPdf(tx, workplaceId, 2027, 5, false));
    const text = await extractText(buf);

    expect(text).toContain("•••");
    expect(text).not.toContain("80,00 €");
    expect(text).not.toContain("54,00 €");
    expect(text).not.toContain("900,00 €");
    expect(text).not.toContain("100,00 €");
    expect(text).not.toContain("1000,00 €");
    expect(text).not.toContain("1134,00 €");
    // Hodiny ostávajú vidno pre všetkých.
    expect(text).toContain("Testovacia Osoba");
    expect(text).toContain("Fixný Plat");
  });
});

describe("renderAllEmployeesIndividualPdf", () => {
  it("obsahuje INDIVIDUÁLNY výpis KAŽDÉHO zamestnanca, jeden pod druhým v jednom PDF (rovnaké čísla ako jednotlivé výpisy), bez odstránených stĺpcov", async () => {
    const buf = await adminDb.transaction((tx) => renderAllEmployeesIndividualPdf(tx, workplaceId, 2027, 5, true));
    const text = await extractText(buf);

    // Traja zamestnanci, každý so svojím "Výkaz dochádzky" nadpisom (3×) —
    // presne ako keby si vytlačil ich jednotlivé výpisy a zošil dokopy.
    expect((text.match(/Výkaz dochádzky/g) ?? []).length).toBe(3);
    expect(text).toContain("Testovacia Osoba");
    expect(text).toContain("E999");
    expect(text).toContain("80,00 €"); // rovnaká suma ako v renderEmployeePdf vyššie
    expect(text).toContain("Iná Osoba");
    expect(text).toContain("E998");
    expect(text).toContain("54,00 €"); // 6h × 9 EUR
    expectRemovedFieldsAbsent(text);

    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
    expect(doc.numPages).toBe(3); // jedna strana na zamestnanca — teraz 3 (pribudol fixný)
  });

  it("fixný zamestnanec má svoju stránku s Fix/Variabilná ZVLÁŠŤ, medzi hodinovými výpismi", async () => {
    const buf = await adminDb.transaction((tx) => renderAllEmployeesIndividualPdf(tx, workplaceId, 2027, 5, true));
    const text = await extractText(buf);

    expect((text.match(/Výkaz dochádzky/g) ?? []).length).toBe(3);
    expect(text).toContain("Fixný Plat");
    expect(text).toContain("E997");
    expect(text).toContain("900,00 €");
    expect(text).toContain("100,00 €");
    expect(text).toContain("1000,00 €");
  });

  it("Fáza 4 (Mzdy) — canViewWages=false: '•••' vo VŠETKÝCH stránkach naraz (hromadný PDF je jeden viewer, jedna maska)", async () => {
    const buf = await adminDb.transaction((tx) => renderAllEmployeesIndividualPdf(tx, workplaceId, 2027, 5, false));
    const text = await extractText(buf);

    expect(text).toContain("•••");
    expect(text).not.toContain("80,00 €");
    expect(text).not.toContain("54,00 €");
    expect(text).not.toContain("900,00 €");
    expect(text).not.toContain("100,00 €");
    expect(text).not.toContain("1000,00 €");
  });
});

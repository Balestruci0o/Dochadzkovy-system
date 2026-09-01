import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { organizations, workplaces } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import { getEmployeeDailyRows } from "../daily-rows";
import { buildMonthlySummary } from "../monthly-summary";
import { EmployeeReportDocument, EmployeeReportPage } from "./employee-document";
import { SummaryReportDocument } from "./summary-document";

type Db = PostgresJsDatabase<typeof schema>;

async function getOrgForWorkplace(tx: Db, workplaceId: string): Promise<{ name: string; ico: string | null }> {
  const [row] = await tx
    .select({ name: organizations.name, ico: organizations.ico })
    .from(organizations)
    .innerJoin(workplaces, eq(workplaces.orgId, organizations.id))
    .where(eq(workplaces.id, workplaceId));
  return row ?? { name: "", ico: null };
}

/** Blok 12, bod 2 — PDF výkaz jedného zamestnanca. */
export async function renderEmployeePdf(tx: Db, workplaceId: string, year: number, month: number, employeeId: string, canViewWages: boolean): Promise<Buffer> {
  const [summary, org] = await Promise.all([buildMonthlySummary(tx, workplaceId, year, month), getOrgForWorkplace(tx, workplaceId)]);
  const employee = summary.employees.find((e) => e.employeeId === employeeId);
  if (!employee) throw new Error("Zamestnanec nie je v tejto prevádzke/období.");

  const dailyRows = await getEmployeeDailyRows(tx, employeeId, workplaceId, year, month);
  return renderToBuffer(EmployeeReportDocument({ orgName: org.name, ico: org.ico, summary, employee, dailyRows, canViewWages }));
}

/** Blok 12, bod 3 — hromadný PDF prehľad prevádzky (súhrnná tabuľka, VŠETCI v jednom riadku). */
export async function renderSummaryPdf(tx: Db, workplaceId: string, year: number, month: number, canViewWages: boolean): Promise<Buffer> {
  const [summary, org] = await Promise.all([buildMonthlySummary(tx, workplaceId, year, month), getOrgForWorkplace(tx, workplaceId)]);
  return renderToBuffer(SummaryReportDocument({ orgName: org.name, ico: org.ico, summary, canViewWages }));
}

/**
 * Hromadný PDF — individuálne výpisy VŠETKÝCH zamestnancov, jeden pod
 * druhým v JEDNOM súbore (na rozdiel od `renderSummaryPdf`, ktorý je jedna
 * súhrnná tabuľka). Presne taký istý formát ako `renderEmployeePdf` pre
 * jedného človeka — `EmployeeReportPage` (stránka bez `<Document>` obálky,
 * viď `employee-document.tsx`) sa tu len poskladá viackrát za sebou do
 * jedného zdieľaného `<Document>`, akoby si vytlačil jednotlivé výpisy
 * všetkých naraz a zošil ich dokopy.
 */
export async function renderAllEmployeesIndividualPdf(tx: Db, workplaceId: string, year: number, month: number, canViewWages: boolean): Promise<Buffer> {
  const [summary, org] = await Promise.all([buildMonthlySummary(tx, workplaceId, year, month), getOrgForWorkplace(tx, workplaceId)]);
  const dailyRowsByEmployee = await Promise.all(
    summary.employees.map((employee) => getEmployeeDailyRows(tx, employee.employeeId, workplaceId, year, month)),
  );

  return renderToBuffer(
    <Document>
      {summary.employees.map((employee, i) => (
        <EmployeeReportPage key={employee.employeeId} orgName={org.name} ico={org.ico} summary={summary} employee={employee} dailyRows={dailyRowsByEmployee[i]} canViewWages={canViewWages} />
      ))}
    </Document>,
  );
}

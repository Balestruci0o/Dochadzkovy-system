import { NextResponse } from "next/server";
import { canViewWages } from "@/lib/auth/manager-permissions";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { renderAllEmployeesIndividualPdf, renderEmployeePdf, renderSummaryPdf } from "@/lib/reports/pdf/render";

/**
 * GET /api/vykazy/pdf?workplaceId=..&year=..&month=..[&employeeId=..|&all=1]
 * (Blok 12, body 2-3). `employeeId` → výkaz JEDNÉHO zamestnanca; `all=1` →
 * individuálne výpisy VŠETKÝCH zamestnancov, jeden pod druhým v jednom PDF
 * (na rozdiel od súhrnnej tabuľky nižšie); inak (predvolené) → hromadný
 * SÚHRNNÝ prehľad prevádzky (všetci v jednej tabuľke). `buildMonthlySummary`
 * beží pod `withUserContext` (accessible_workplaces()) — rovnaká ochrana
 * ako /api/vykazy/excel.
 */
export async function GET(request: Request) {
  const user = await requireRole("owner", "manager", "accountant");

  const { searchParams } = new URL(request.url);
  const workplaceId = searchParams.get("workplaceId");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  const employeeId = searchParams.get("employeeId");
  const allIndividual = searchParams.get("all") === "1";

  if (!workplaceId || !year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "Chýbajúci alebo neplatný workplaceId/year/month." }, { status: 400 });
  }

  const canSeeWages = canViewWages(user.role, user.permissions);

  let buffer: Buffer;
  let filenamePart: string;
  try {
    if (employeeId) {
      buffer = await withUserContext(user.id, (tx) => renderEmployeePdf(tx, workplaceId, year, month, employeeId, canSeeWages));
      filenamePart = "zamestnanec";
    } else if (allIndividual) {
      buffer = await withUserContext(user.id, (tx) => renderAllEmployeesIndividualPdf(tx, workplaceId, year, month, canSeeWages));
      filenamePart = "individualne-vypisy";
    } else {
      buffer = await withUserContext(user.id, (tx) => renderSummaryPdf(tx, workplaceId, year, month, canSeeWages));
      filenamePart = "prevadzka";
    }
  } catch {
    return NextResponse.json({ error: "Prevádzka/zamestnanec neexistuje alebo k nemu nemáš prístup." }, { status: 404 });
  }

  const filename = `vykaz_${filenamePart}_${year}-${String(month).padStart(2, "0")}.pdf`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

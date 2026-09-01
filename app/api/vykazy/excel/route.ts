import { NextResponse } from "next/server";
import { canViewWages } from "@/lib/auth/manager-permissions";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { buildMonthlyExcel } from "@/lib/reports/monthly-excel";
import { buildMonthlySummary } from "@/lib/reports/monthly-summary";

/**
 * GET /api/vykazy/excel?workplaceId=..&year=..&month=.. (Blok 12, bod 4).
 * `buildMonthlySummary` beží pod `withUserContext` — prevádzka mimo
 * prístupu volajúceho vyhodí chybu (accessible_workplaces(), viď
 * `lib/reports/monthly-summary.ts`), nie tichý únik dát.
 */
export async function GET(request: Request) {
  const user = await requireRole("owner", "manager", "accountant");

  const { searchParams } = new URL(request.url);
  const workplaceId = searchParams.get("workplaceId");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (!workplaceId || !year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "Chýbajúci alebo neplatný workplaceId/year/month." }, { status: 400 });
  }

  let summary;
  try {
    summary = await withUserContext(user.id, (tx) => buildMonthlySummary(tx, workplaceId, year, month));
  } catch {
    return NextResponse.json({ error: "Prevádzka neexistuje alebo k nej nemáš prístup." }, { status: 404 });
  }

  const buffer = await buildMonthlyExcel(summary, canViewWages(user.role, user.permissions));
  const filename = `vykaz_dochadzky_${summary.workplaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}_${year}-${String(month).padStart(2, "0")}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

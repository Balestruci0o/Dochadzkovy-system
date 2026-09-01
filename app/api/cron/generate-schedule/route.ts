import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
// eslint-disable-next-line no-restricted-imports -- cron beží bez prihláseného používateľa, žiadny app.user_id neexistuje (docs/ARCHITECTURE.md, service role výnimka pre cron joby — rovnaká ako runAutoClose())
import { adminDb } from "@/lib/db/admin";
import { workplaces } from "@/lib/db/schema";
import { runGenerateAsCron } from "@/lib/scheduler/run-generate";
import { daysInMonth, shiftMonth } from "@/lib/shared/dates";
import { localDateStr } from "@/lib/shared/time";

const DAYS_BEFORE_MONTH_END = 7;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(header);
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * GET /api/cron/generate-schedule (Blok 9d-5, docs/ARCHITECTURE.md — "Vercel
 * Cron, 7 dní pred koncom mesiaca, pre každú prevádzku zvlášť"). Rovnaký
 * auth vzor ako `/api/cron/auto-close` — `Authorization: Bearer
 * <CRON_SECRET>`, bez neho 401. `vercel.json` volá toto DENNE (počet dní do
 * konca mesiaca sa mení podľa dĺžky mesiaca, pevný cron výraz "N. deň v
 * mesiaci" by to nevedel vyjadriť pre všetky mesiace naraz) — endpoint sám
 * si overí, či je DNES presne 7 dní pred koncom AKTUÁLNEHO mesiaca, a ak
 * nie je, je to no-op (200, nie chyba — cron beží každý deň zámerne).
 *
 * Generuje rozvrh pre NASLEDUJÚCI mesiac (zamestnanci ho potrebujú vopred).
 * Každá prevádzka je VLASTNÝ pokus — zlyhanie jednej (napr. chýbajúce
 * pokrytie) nezastaví ostatné, presne v duchu princípu „generátor nechá
 * dieru, nenásili" rozšíreného na "jeden beh nezhodí
 * druhý". `triggeredByUserId = null` (cron, nie je kto) — `persistGenerateResult`
 * (Blok 9d-2/9d-3) to podporuje presne pre tento prípad.
 *
 * NEBEŽÍ ešte reálne v produkcii (žiadny `CRON_SECRET` nie je nastavený) —
 * pripravené a zabezpečené, čaká na potvrdenie pravidiel pokrytia pre danú
 * organizáciu, nie na kód.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Neautorizované." }, { status: 401 });
  }

  const todayStr = localDateStr(new Date());
  const [y, m, d] = todayStr.split("-").map(Number);
  const remainingDays = daysInMonth(y, m) - d;

  if (remainingDays !== DAYS_BEFORE_MONTH_END) {
    return NextResponse.json({ skipped: true, reason: `Dnes nie je ${DAYS_BEFORE_MONTH_END} dní pred koncom mesiaca (zostáva ${remainingDays}).` });
  }

  const target = shiftMonth(y, m, 1);
  const activeWorkplaces = await adminDb.select({ id: workplaces.id, name: workplaces.name }).from(workplaces).where(eq(workplaces.isActive, true));

  const results: {
    workplaceId: string;
    workplaceName: string;
    ok: boolean;
    shiftsCreated?: number;
    gapsRecorded?: number;
    error?: string;
  }[] = [];

  for (const wp of activeWorkplaces) {
    try {
      const report = await adminDb.transaction((tx) => runGenerateAsCron(tx, wp.id, target.year, target.month));
      results.push({ workplaceId: wp.id, workplaceName: wp.name, ok: true, shiftsCreated: report.shiftsCreated, gapsRecorded: report.gapsRecorded });
    } catch (e) {
      results.push({ workplaceId: wp.id, workplaceName: wp.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ year: target.year, month: target.month, results });
}

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { withUserContext } from "@/lib/db";
import type * as schema from "@/lib/db/schema";
import { shiftLeaderAssignments, workplaces } from "@/lib/db/schema";
import { notifyScheduleGapDetected, notifyScheduleGenerated } from "@/lib/notifications/events";
import { loadGenerateInput } from "./db-loader";
import { persistGenerateResult, type PersistGenerateResultSummary } from "./db-writer";
import { generateSchedule } from "./generate";
import { assignShiftLeaders, type ExistingManualLeader } from "./shift-leader";
import { persistShiftLeaderResult } from "./shift-leader-writer";

type Db = PostgresJsDatabase<typeof schema>;

export type GenerateReport = PersistGenerateResultSummary & {
  gaps: { date: string; message: string }[];
};

/**
 * Blok 9d-5 (🔍) — jadro zdieľané MEDZI UI tlačidlom ("Generovať/Pregenerovať
 * rozvrh", `app/(app)/kalendar/generate-actions.ts`) A cron endpointom
 * (`app/api/cron/generate-schedule/route.ts`), aby sa "generuj z UI" a
 * "generuj z cronu" nikdy nerozišli na dve samostatne udržiavané cesty.
 * `loadGenerateInput` → `generateSchedule` → `persistGenerateResult` v
 * JEDNEJ transakcii (`tx`, ktorý dostane) — "celý rozvrh alebo nič" platí
 * aj pre samotné NAČÍTANIE vstupu, nielen zápis výsledku.
 */
async function runGenerate(tx: Db, workplaceId: string, year: number, month: number, triggeredByUserId: string | null): Promise<GenerateReport> {
  const { input } = await loadGenerateInput(tx, workplaceId, year, month);
  const result = generateSchedule(input);
  const summary = await persistGenerateResult(tx, workplaceId, year, month, result, triggeredByUserId);

  // Vedúci smeny, krok 2 — samostatný POSLEDNÝ prechod NAD hotovým výsledkom
  // generovania (`result.assignments`, po všetkých repair passoch generátora).
  // Musí bežať AŽ PO `persistGenerateResult` (tá po ceste vyrieši staré
  // `schedule_violations` tohto rozvrhu vrátane starých NO_SHIFT_LEADER,
  // viď `shift-leader-writer.ts`).
  //
  // Krok 6 (regenerácia) — RUČNE nastavené dni (`source = 'manual'`) tejto
  // prevádzky sa NAČÍTAJÚ (bez dátumového orezania — manuálnych riadkov je v
  // praxi málo, netreba dopočítavať presné okno "chvosta") a odovzdajú
  // `assignShiftLeaders` ako "pravda o tom dni" — algoritmus do nich nikdy
  // nezapíše (`persistShiftLeaderResult` ich aj tak chráni), ale kontinuita/
  // seniorita/férovosť ich zohľadní pri prepočte OKOLITÝCH (generovaných) dní.
  const manualLeaderRows = await tx
    .select({ positionId: shiftLeaderAssignments.positionId, date: shiftLeaderAssignments.date, employeeId: shiftLeaderAssignments.employeeId })
    .from(shiftLeaderAssignments)
    .where(and(eq(shiftLeaderAssignments.workplaceId, workplaceId), eq(shiftLeaderAssignments.source, "manual")));
  const existingManualLeaders: ExistingManualLeader[] = manualLeaderRows;

  const shiftLeaderResult = assignShiftLeaders(input, result.assignments, existingManualLeaders);
  await persistShiftLeaderResult(tx, workplaceId, year, month, shiftLeaderResult);

  const [workplace] = await tx.select({ orgId: workplaces.orgId, name: workplaces.name }).from(workplaces).where(eq(workplaces.id, workplaceId));
  if (workplace) {
    if (result.gaps.length > 0) {
      await notifyScheduleGapDetected(tx, { orgId: workplace.orgId, workplaceId, workplaceName: workplace.name, year, month, gapCount: result.gaps.length });
    }
    await notifyScheduleGenerated(tx, {
      orgId: workplace.orgId,
      workplaceId,
      workplaceName: workplace.name,
      year,
      month,
      shiftsCreated: summary.shiftsCreated,
      gapCount: result.gaps.length,
    });
  }

  return { ...summary, gaps: result.gaps.map((g) => ({ date: g.date, message: g.message })) };
}

/**
 * Používateľom vyvolané generovanie (UI tlačidlo, owner/manažér). Beží pod
 * JEHO identitou (`withUserContext`) — RLS (`accessible_workplaces()`) sama
 * zaručí, že manažér nevygeneruje rozvrh pre prevádzku, ku ktorej nemá
 * prístup, presne ako pri každom inom čítaní/zápise v appke. Netreba to
 * overovať znova v aplikačnej vrstve navyše.
 */
export async function runGenerateAsUser(userId: string, workplaceId: string, year: number, month: number): Promise<GenerateReport> {
  return withUserContext(userId, (tx) => runGenerate(tx, workplaceId, year, month, userId));
}

/**
 * Cron generovanie (bez prihláseného používateľa) — VOLAJÚCI (cron route)
 * dodá `tx` zo service-role transakcie (`adminDb.transaction`), presne ako
 * `runAutoClose()` používa `adminDb` (docs/ARCHITECTURE.md, výslovná service-role
 * výnimka pre cron joby). `triggeredByUserId` je `null` — nie je kto.
 */
export async function runGenerateAsCron(tx: Db, workplaceId: string, year: number, month: number): Promise<GenerateReport> {
  return runGenerate(tx, workplaceId, year, month, null);
}

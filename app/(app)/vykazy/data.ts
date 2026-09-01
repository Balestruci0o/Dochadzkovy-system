import { and, asc, eq, sql } from "drizzle-orm";
import { withUserContext } from "@/lib/db";
import { workplaces } from "@/lib/db/schema";
import { buildMonthlySummary, type MonthlySummary } from "@/lib/reports/monthly-summary";
import type { CurrentUser } from "@/lib/auth/session";

export type VykazyData = {
  allWorkplaces: { id: string; name: string }[];
  workplace: { id: string; name: string } | null;
  summary: MonthlySummary | null;
};

/**
 * Blok 12 — rovnaký vzor ako `app/(app)/kalendar/data.ts`: len PRÍSTUPNÉ
 * prevádzky (`accessible_workplaces()`, nie `workplaces_select` RLS samotné,
 * ktoré je len org-wide), default na prvú, ak požadovaná chýba/nie je prístupná.
 */
export async function getVykazyData(
  user: CurrentUser,
  requestedWorkplaceId: string | undefined,
  year: number,
  month: number,
): Promise<VykazyData> {
  return withUserContext(user.id, async (tx) => {
    const allWorkplaces = await tx
      .select({ id: workplaces.id, name: workplaces.name })
      .from(workplaces)
      .where(and(eq(workplaces.orgId, user.orgId), sql`${workplaces.id} IN (SELECT accessible_workplaces())`))
      .orderBy(asc(workplaces.name));

    const workplace = allWorkplaces.find((w) => w.id === requestedWorkplaceId) ?? allWorkplaces[0] ?? null;
    if (!workplace) return { allWorkplaces, workplace: null, summary: null };

    const summary = await buildMonthlySummary(tx, workplace.id, year, month);
    return { allWorkplaces, workplace, summary };
  });
}

import { and, asc, eq, inArray } from "drizzle-orm";
import { CoverageList } from "@/components/settings/coverage-list";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { coverageRequirements, positions, shiftTemplates, workplaces } from "@/lib/db/schema";

export default async function PokrytiePage() {
  const user = await requirePermission("manageRules");

  // Jedna transakcia, štyri súbežné dotazy — pokrytie/šablóny filtrujú cez
  // SQL subquery, nie cez ID-čka zozbierané v JS z workplaces dotazu
  // (predtým samostatná druhá transakcia = extra round-trip navyše).
  const [workplaceRows, positionRows, shiftTemplateRows, coverageRows] = await withUserContext(user.id, (tx) =>
    Promise.all([
      tx
        .select({ id: workplaces.id, name: workplaces.name })
        .from(workplaces)
        .where(eq(workplaces.orgId, user.orgId))
        .orderBy(asc(workplaces.name)),
      tx
        .select({ id: positions.id, name: positions.name })
        .from(positions)
        .where(eq(positions.orgId, user.orgId))
        .orderBy(asc(positions.name)),
      tx
        .select({ id: shiftTemplates.id, name: shiftTemplates.name, workplaceId: shiftTemplates.workplaceId, startTime: shiftTemplates.startTime, endTime: shiftTemplates.endTime })
        .from(shiftTemplates)
        .where(
          and(
            inArray(shiftTemplates.workplaceId, tx.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.orgId, user.orgId))),
            eq(shiftTemplates.isActive, true),
          ),
        )
        .orderBy(asc(shiftTemplates.name)),
      tx
        .select()
        .from(coverageRequirements)
        .where(
          inArray(
            coverageRequirements.workplaceId,
            tx.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.orgId, user.orgId)),
          ),
        )
        .orderBy(asc(coverageRequirements.id)),
    ]),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <CoverageList
        requirements={coverageRows}
        workplaceOptions={workplaceRows}
        positionOptions={positionRows}
        shiftTemplateOptions={shiftTemplateRows}
      />
    </div>
  );
}

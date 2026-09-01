import { asc, eq, inArray } from "drizzle-orm";
import { ShiftTemplateList } from "@/components/settings/shift-template-list";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { shiftTemplates, workplaces } from "@/lib/db/schema";

export default async function ZmenyPage() {
  const user = await requirePermission("managePositionsShifts");

  // Jedna transakcia, dva súbežné dotazy — druhý filtruje cez SQL subquery
  // (workplace_id IN (SELECT id FROM workplaces ...)), nie cez ID-čka
  // zozbierané v JS z prvého dotazu. Predtým to boli dve samostatné
  // transakcie za sebou (dva round-tripy namiesto jedného).
  const [workplaceRows, templateRows] = await withUserContext(user.id, (tx) =>
    Promise.all([
      tx
        .select({ id: workplaces.id, name: workplaces.name })
        .from(workplaces)
        .where(eq(workplaces.orgId, user.orgId))
        .orderBy(asc(workplaces.name)),
      tx
        .select()
        .from(shiftTemplates)
        .where(
          inArray(
            shiftTemplates.workplaceId,
            tx.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.orgId, user.orgId)),
          ),
        )
        .orderBy(asc(shiftTemplates.name)),
    ]),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <ShiftTemplateList templates={templateRows} workplaceOptions={workplaceRows} />
    </div>
  );
}

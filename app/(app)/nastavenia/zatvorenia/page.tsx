import { asc, desc, eq, inArray } from "drizzle-orm";
import { ClosureList } from "@/components/settings/closure-list";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { workplaceClosures, workplaces } from "@/lib/db/schema";

export default async function ZatvoreniaPage() {
  const user = await requirePermission("manageRules");

  // Jedna transakcia, dva súbežné dotazy — druhý filtruje cez SQL subquery,
  // nie cez ID-čka zozbierané v JS z prvého dotazu (predtým dve samostatné
  // transakcie za sebou = dva round-tripy namiesto jedného).
  const [workplaceRows, closureRows] = await withUserContext(user.id, (tx) =>
    Promise.all([
      tx
        .select({ id: workplaces.id, name: workplaces.name })
        .from(workplaces)
        .where(eq(workplaces.orgId, user.orgId))
        .orderBy(asc(workplaces.name)),
      tx
        .select()
        .from(workplaceClosures)
        .where(
          inArray(
            workplaceClosures.workplaceId,
            tx.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.orgId, user.orgId)),
          ),
        )
        .orderBy(desc(workplaceClosures.date)),
    ]),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <ClosureList closures={closureRows} workplaceOptions={workplaceRows} />
    </div>
  );
}

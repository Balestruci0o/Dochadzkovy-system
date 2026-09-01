import { asc, eq } from "drizzle-orm";
import { PositionList } from "@/components/settings/position-list";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { positions, workplaces } from "@/lib/db/schema";

export default async function PoziciePage() {
  const user = await requirePermission("managePositionsShifts");

  const [positionRows, workplaceRows] = await withUserContext(user.id, (tx) =>
    Promise.all([
      tx.select().from(positions).where(eq(positions.orgId, user.orgId)).orderBy(asc(positions.name)),
      tx
        .select({ id: workplaces.id, name: workplaces.name })
        .from(workplaces)
        .where(eq(workplaces.orgId, user.orgId))
        .orderBy(asc(workplaces.name)),
    ]),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <PositionList positions={positionRows} workplaceOptions={workplaceRows} />
    </div>
  );
}

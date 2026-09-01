import { asc, eq } from "drizzle-orm";
import { WorkplaceList } from "@/components/settings/workplace-list";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { workplaces } from "@/lib/db/schema";

export default async function PrevadzkyPage() {
  const user = await requireRole("owner");

  const rows = await withUserContext(user.id, (tx) =>
    tx.select().from(workplaces).where(eq(workplaces.orgId, user.orgId)).orderBy(asc(workplaces.name)),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <WorkplaceList workplaces={rows} />
    </div>
  );
}

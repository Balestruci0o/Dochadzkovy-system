import { asc, eq, inArray } from "drizzle-orm";
import { TerminalList } from "@/components/settings/terminal-list";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { terminals, workplaces } from "@/lib/db/schema";

export default async function TerminalyPage() {
  const user = await requirePermission("manageTerminals");

  // Jedna transakcia, dva súbežné dotazy — druhý filtruje cez SQL subquery,
  // nie cez ID-čka zozbierané v JS z prvého dotazu (predtým dve samostatné
  // transakcie za sebou = dva round-tripy namiesto jedného).
  const [workplaceRows, terminalRows] = await withUserContext(user.id, (tx) =>
    Promise.all([
      tx
        .select({ id: workplaces.id, name: workplaces.name })
        .from(workplaces)
        .where(eq(workplaces.orgId, user.orgId))
        .orderBy(asc(workplaces.name)),
      tx
        .select({
          id: terminals.id,
          workplaceId: terminals.workplaceId,
          name: terminals.name,
          deviceId: terminals.deviceId,
          lastSeenAt: terminals.lastSeenAt,
          isActive: terminals.isActive,
        })
        .from(terminals)
        .where(
          inArray(
            terminals.workplaceId,
            tx.select({ id: workplaces.id }).from(workplaces).where(eq(workplaces.orgId, user.orgId)),
          ),
        )
        .orderBy(asc(terminals.name)),
    ]),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <TerminalList terminals={terminalRows} workplaceOptions={workplaceRows} />
    </div>
  );
}

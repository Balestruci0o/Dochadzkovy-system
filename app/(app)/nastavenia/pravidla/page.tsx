import { asc, eq } from "drizzle-orm";
import { LegalRuleList } from "@/components/settings/legal-rule-list";
import { requirePermission } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { legalRules } from "@/lib/db/schema";

export default async function PravidlaPage() {
  const user = await requirePermission("manageRules");

  const rows = await withUserContext(user.id, (tx) =>
    tx.select().from(legalRules).where(eq(legalRules.orgId, user.orgId)).orderBy(asc(legalRules.code)),
  );

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <LegalRuleList rules={rows.map((r) => ({ ...r, params: r.params as Record<string, unknown> }))} />
    </div>
  );
}

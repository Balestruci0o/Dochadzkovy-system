import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EmployeeCreateForm } from "@/components/employees/employee-create-form";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { positions, workplaces } from "@/lib/db/schema";

export default async function NovyZamestnanecPage() {
  const user = await requireRole("owner", "manager");

  const [workplaceOptions, positionOptions] = await withUserContext(user.id, (tx) =>
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
    ]),
  );

  return (
    <div>
      <Link
        href="/zamestnanci"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
      >
        <ArrowLeft size={16} /> Späť na zoznam
      </Link>
      <div className="rounded-[14px] border border-line bg-paper p-6 shadow-sm">
        <h2 className="mb-5 font-serif text-xl font-bold text-ink">Nový zamestnanec</h2>
        <EmployeeCreateForm
          workplaces={workplaceOptions}
          positions={positionOptions}
          canSetRate={user.role === "owner"}
        />
      </div>
    </div>
  );
}

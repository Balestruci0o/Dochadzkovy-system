import { asc, eq } from "drizzle-orm";
import { EmployeeList } from "@/components/employees/employee-list";
import { requireRole } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { positions } from "@/lib/db/schema";
import { listEmployees } from "./data";

export default async function ZamestnanciPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeDeleted?: string; authCleanupFailed?: string }>;
}) {
  const user = await requireRole("owner", "manager");
  const { employeeDeleted, authCleanupFailed } = await searchParams;

  const [employees, positionOptions] = await Promise.all([
    listEmployees(user),
    withUserContext(user.id, (tx) =>
      tx
        .select({ id: positions.id, name: positions.name })
        .from(positions)
        .where(eq(positions.orgId, user.orgId))
        .orderBy(asc(positions.name)),
    ),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {employeeDeleted && (
        <p className="rounded-md border border-ok/40 bg-ok-tint px-4 py-3 text-sm text-ok">
          Zamestnanec bol natrvalo zmazaný.
        </p>
      )}
      {authCleanupFailed && (
        <p className="rounded-md border border-late/40 bg-late-tint px-4 py-3 text-sm text-late">
          Prihlasovacie konto sa nepodarilo úplne uvoľniť (zlyhalo zmazanie v Supabase Auth) — email
          zamestnanca sa možno nedá hneď znova pozvať („already been registered“). Kontaktuj podporu,
          nech konto v Supabase Auth zmaže ručne.
        </p>
      )}
      <EmployeeList
        employees={employees}
        positionOptions={positionOptions}
        canCreate={user.role === "owner" || user.role === "manager"}
      />
    </div>
  );
}

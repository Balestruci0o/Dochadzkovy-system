import { and, asc, eq, isNull } from "drizzle-orm";
import { DEFAULT_MANAGER_PERMISSIONS, type ManagerPermissions } from "@/lib/auth/manager-permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { managerPermissions, managerWorkplaces, organizations, users, workplaces } from "@/lib/db/schema";

export type AccountRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: "owner" | "manager" | "employee" | "accountant";
  isActive: boolean;
  invitedAt: Date | null;
  activatedAt: Date | null;
  managedWorkplaces: { id: string; name: string }[];
  /** Len pre role==='manager' — pre iné role nepoužitý default (žiadny riadok = default, viď manager-permissions.ts). */
  permissions: ManagerPermissions;
};

/**
 * Blok 13, body 1-2 — owner doteraz videl LEN zamestnancov (`/zamestnanci`,
 * zámerne obmedzené na `employees`, viď `app/(app)/zamestnanci/data.ts`) —
 * manažérske/účtovnícke kontá (čisté `users` riadky bez `employees`
 * náprotivku) nemal kde vidieť vôbec. Táto stránka je nad `users` priamo,
 * nie nad `employees`.
 */
export async function getKontaData(user: CurrentUser) {
  return withUserContext(user.id, async (tx) => {
    const [org, userRows, allWorkplaces, managerWorkplaceRows, permissionRows] = await Promise.all([
      tx.select().from(organizations).where(eq(organizations.id, user.orgId)),
      tx
        .select()
        .from(users)
        .where(and(eq(users.orgId, user.orgId), isNull(users.deletedAt)))
        .orderBy(asc(users.role), asc(users.fullName)),
      tx.select({ id: workplaces.id, name: workplaces.name }).from(workplaces).where(eq(workplaces.orgId, user.orgId)).orderBy(asc(workplaces.name)),
      tx
        .select({ userId: managerWorkplaces.userId, workplaceId: workplaces.id, workplaceName: workplaces.name })
        .from(managerWorkplaces)
        .innerJoin(workplaces, eq(workplaces.id, managerWorkplaces.workplaceId)),
      // Jeden dotaz pre VŠETKÝCH manažérov tejto org (manager_permissions_select
      // RLS už scoped na org ownera) — žiadny riadok = default, viď mapovanie nižšie.
      tx.select().from(managerPermissions),
    ]);

    const managedByUser = new Map<string, { id: string; name: string }[]>();
    for (const r of managerWorkplaceRows) {
      const list = managedByUser.get(r.userId) ?? [];
      list.push({ id: r.workplaceId, name: r.workplaceName });
      managedByUser.set(r.userId, list);
    }

    const permissionsByUser = new Map<string, ManagerPermissions>();
    for (const r of permissionRows) {
      permissionsByUser.set(r.userId, {
        managePositionsShifts: r.managePositionsShifts,
        manageRules: r.manageRules,
        manageAccounts: r.manageAccounts,
        viewWages: r.viewWages,
        editWages: r.editWages,
        manageTerminals: r.manageTerminals,
      });
    }

    const accounts: AccountRow[] = userRows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      // email je v schéme nullable len kvôli soft-delete (users.deletedAt) —
      // query vyššie filtruje isNull(deletedAt), takže tu je vždy vyplnený.
      email: u.email ?? "",
      phone: u.phone,
      role: u.role,
      isActive: u.isActive,
      invitedAt: u.invitedAt,
      activatedAt: u.activatedAt,
      managedWorkplaces: managedByUser.get(u.id) ?? [],
      permissions: permissionsByUser.get(u.id) ?? { ...DEFAULT_MANAGER_PERMISSIONS },
    }));

    return { accounts, allWorkplaces, support: org[0] ?? null };
  });
}

export type KontaData = Awaited<ReturnType<typeof getKontaData>>;

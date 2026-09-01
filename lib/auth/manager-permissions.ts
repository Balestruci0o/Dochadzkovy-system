import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { managerPermissions } from "@/lib/db/schema";
import type * as schema from "@/lib/db/schema";
import type { UserRole } from "@/lib/auth/session";

type Db = PostgresJsDatabase<typeof schema>;

export type ManagerPermissionKey =
  | "managePositionsShifts"
  | "manageRules"
  | "manageAccounts"
  | "viewWages"
  | "editWages"
  | "manageTerminals";

export type ManagerPermissions = Record<ManagerPermissionKey, boolean>;

/**
 * MUSÍ sedieť so stĺpcovými defaultmi (migrácia 0047) AJ s
 * has_manager_permission() v SQL — tri nezávislé miesta, čo musia zostať v
 * zhode. Jediný default-true balíček je viewWages (dnešné manažérske
 * správanie — mzdy vo výkazoch vidno bez obmedzenia).
 */
export const DEFAULT_MANAGER_PERMISSIONS: ManagerPermissions = {
  managePositionsShifts: false,
  manageRules: false,
  manageAccounts: false,
  viewWages: true,
  editWages: false,
  manageTerminals: false,
};

/**
 * Žiadny riadok = dnešné manažérske práva (spätná kompatibilita — pozri
 * DEFAULT_MANAGER_PERMISSIONS vyššie). `db` môže byť `adminDb` (bootstrap v
 * session.ts, rovnaký dôvod ako getCurrentUser()) alebo `tx` pod
 * withUserContext (RLS-scoped) — obe majú rovnaké Drizzle rozhranie.
 */
export async function getManagerPermissions(db: Db, userId: string): Promise<ManagerPermissions> {
  const [row] = await db.select().from(managerPermissions).where(eq(managerPermissions.userId, userId)).limit(1);
  if (!row) return { ...DEFAULT_MANAGER_PERMISSIONS };
  return {
    managePositionsShifts: row.managePositionsShifts,
    manageRules: row.manageRules,
    manageAccounts: row.manageAccounts,
    viewWages: row.viewWages,
    editWages: row.editWages,
    manageTerminals: row.manageTerminals,
  };
}

/**
 * Owner má vždy všetko (rovnaká skratka ako is_owner() v RLS). Employee/
 * accountant sú VŽDY false, bez ohľadu na obsah `permissions` — pole má
 * zmysel len pre manažéra, no funkcia sama si to musí vynútiť (nespoliehať
 * sa, že volajúci vždy prejde cez requireRole("owner","manager") ako prvé).
 */
export function hasManagerPermission(role: UserRole, permissions: ManagerPermissions, permission: ManagerPermissionKey): boolean {
  if (role === "owner") return true;
  if (role !== "manager") return false;
  return permissions[permission];
}

const SETTINGS_PERMISSIONS: ManagerPermissionKey[] = ["managePositionsShifts", "manageRules", "manageAccounts", "manageTerminals"];

/**
 * "Prístup do Nastavení" — ODVODENÝ (aspoň jeden nastavenia-balíček
 * zapnutý), nemá vlastný stĺpec. Bez toho by mohol nastať nekonzistentný
 * stav (owner zapne "Pozície", zabudne zapnúť master-switch → ticho
 * nefunguje).
 */
export function hasSettingsAccess(role: UserRole, permissions: ManagerPermissions): boolean {
  return SETTINGS_PERMISSIONS.some((p) => hasManagerPermission(role, permissions, p));
}

/**
 * Fáza 4 (Mzdy) — VIDITEĽNOSŤ miezd na `/vykazy` a exportoch. NIE je to
 * jednoducho `hasManagerPermission(..., "viewWages")` — účtovníčka vidí
 * mzdy VŽDY, bezpodmienečne (rovnaká vetva v RLS `rate_select`/
 * `salary_select`, migrácia 0050, nezávislá od has_manager_permission()).
 * Táto funkcia je APLIKAČNÁ vrstva pre "•••" vs. skutočná suma — kozmetika,
 * NIE bezpečnosť. Bezpečnosť drží RLS: keď manažér `view_wages` nemá,
 * rate_select/salary_select mu jednoducho nevráti riadky a grossWage vyjde
 * ticho 0 — táto funkcia len rozhoduje, či mu appka ukáže "0,00 €" (mätúce,
 * vyzerá ako chyba dát) alebo "•••" (jasné, že je to skryté pravomocou).
 */
export function canViewWages(role: UserRole, permissions: ManagerPermissions): boolean {
  return role === "accountant" || hasManagerPermission(role, permissions, "viewWages");
}

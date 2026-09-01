import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/db/admin";
import { withUserContext } from "@/lib/db";
import { userRoleEnum, users } from "@/lib/db/schema";
import {
  DEFAULT_MANAGER_PERMISSIONS,
  getManagerPermissions,
  hasManagerPermission,
  hasSettingsAccess,
  type ManagerPermissionKey,
  type ManagerPermissions,
} from "@/lib/auth/manager-permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type CurrentUser = {
  id: string;
  authUserId: string;
  orgId: string;
  role: UserRole;
  fullName: string;
  email: string;
  /**
   * Granulárne pravomoci manažérov — rozlíšené RAZ za request (rovnaký dôvod
   * ako `cache()` na getCurrentUser()). Relevantné len pre role==='manager';
   * pre iné role je to nepoužitý default objekt (owner má vždy všetko cez
   * hasManagerPermission()/requirePermission(), nikdy sa doň nepozerá).
   * NEČÍTAJ toto pole priamo mimo lib/auth/manager-permissions.ts — vždy cez
   * hasManagerPermission()/hasSettingsAccess()/requirePermission().
   */
  permissions: ManagerPermissions;
};

/**
 * Načíta prihláseného používateľa a spáruje Supabase Auth session s naším
 * `users` riadkom. Toto je JEDINÝ legitímny dôvod na `adminDb` mimo
 * service-role ciest z docs/ARCHITECTURE.md: kým nepoznáme `users.id`, nemáme čo
 * dať do `app.user_id`, takže RLS na `users` by nevrátilo nič
 * (fail-safe). Všetko ĎALŠIE po tomto bode ide cez
 * `withUserContext`/`withCurrentUser`, nie cez `adminDb`.
 *
 * `supabase.auth.getUser()` je sieťové volanie na Supabase Auth API — a
 * middleware.ts ho už raz urobilo pre tento istý request (inak by appka
 * neprešla ďalej). Namiesto duplicitného volania (dvojnásobná sieťová
 * latencia na KAŽDÚ navigáciu) čítame overené `auth_user_id` z hlavičky
 * `x-supabase-user-id`, ktorú middleware nastavuje. Fallback na skutočné
 * `getUser()` zostáva len pre prípad, že by middleware z nejakého dôvodu
 * nebežal (matcher by mal pokrývať všetko okrem statických assetov).
 *
 * `cache()` z Reactu zabezpečí, že sa toto v rámci jedného requestu spýta
 * len raz, aj keď ho zavolá viacero Server Components.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const h = await headers();
  let authUserId = h.get("x-supabase-user-id");

  if (!authUserId) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return null;
    authUserId = authUser.id;
  }

  const [row] = await adminDb.select().from(users).where(eq(users.authUserId, authUserId)).limit(1);

  // `row.email === null` je prakticky nedosiahnuteľné (soft-delete zároveň
  // vynuluje `authUserId`, takže zmazané konto sa sem cez `eq(authUserId, ...)`
  // nikdy nedostane) — ponechané ako fail-safe, nie fail-open.
  if (!row || !row.isActive || row.email === null) return null;

  // Rozlíšené len pre manažéra (jediná rola, kde majú pravomoci zmysel) —
  // ostatné role nepotrebujú extra dotaz. `adminDb` tu je v poriadku z
  // ROVNAKÉHO dôvodu ako vyššie (bootstrap identity, nie appkové dáta) — ide
  // o VLASTNÝ riadok práve identifikovaného používateľa, nie cudzie dáta.
  const permissions = row.role === "manager" ? await getManagerPermissions(adminDb, row.id) : { ...DEFAULT_MANAGER_PERMISSIONS };

  return {
    id: row.id,
    authUserId,
    orgId: row.orgId,
    role: row.role,
    fullName: row.fullName,
    email: row.email,
    permissions,
  };
});

/** Presmeruje na /prihlasenie, ak nie je nikto prihlásený. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/prihlasenie");
  return user;
}

/** Ako requireUser(), navyše overí rolu. Bez zhody presmeruje na "/". */
export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

/**
 * Granulárne pravomoci manažérov — ako requireRole("owner","manager"), navyše
 * overí konkrétny balíček (owner prejde vždy). Toto je APLIKAČNÁ vrstva
 * (UX — presmerovanie/skrytie), NIE primárna obrana — tú drží RLS
 * (has_manager_permission() v migrácii 0047) nezávisle na každej dotknutej
 * tabuľke. Bez zhody presmeruje na "/", rovnako ako requireRole.
 */
export async function requirePermission(permission: ManagerPermissionKey): Promise<CurrentUser> {
  const user = await requireRole("owner", "manager");
  if (!hasManagerPermission(user.role, user.permissions, permission)) redirect("/");
  return user;
}

/**
 * Blanket gate na CELÚ /nastavenia sekciu (nastavenia/layout.tsx) — "Prístup
 * do Nastavení" je ODVODENÝ (aspoň jeden manage_*-balíček), nemá vlastný
 * stĺpec (viď hasSettingsAccess). Jednotlivé podstránky ĎALEJ overujú svoj
 * KONKRÉTNY balíček cez requirePermission() nezávisle — toto je len prvá
 * (rýchla) vrstva, nie náhrada za tú druhú.
 */
export async function requireSettingsAccess(): Promise<CurrentUser> {
  const user = await requireRole("owner", "manager");
  if (!hasSettingsAccess(user.role, user.permissions)) redirect("/");
  return user;
}

/**
 * Ergonomický wrapper: načíta usera, presmeruje ak treba, a spustí `fn` v
 * transakcii so `SET LOCAL app.user_id` (cez withUserContext). Toto je
 * bežný spôsob, akým Server Component/Action pristupuje k dátam — nikdy
 * priamo cez adminDb.
 */
export async function withCurrentUser<T>(
  fn: (tx: Parameters<Parameters<typeof withUserContext>[1]>[0], user: CurrentUser) => Promise<T>,
): Promise<T> {
  const user = await requireUser();
  return withUserContext(user.id, (tx) => fn(tx, user));
}

import { and, eq, ne, sql } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { managerWorkplaces, organizations, users } from "@/lib/db/schema";

export type ContactPerson = { fullName: string; email: string | null; phone: string | null };

/**
 * Blok 13, bod 6 — "manažér" tu NIE JE per-rola, ale per-VIEWER: rovnaká
 * `accessible_workplaces()` funkcia ako všade inde v appke (owner vidí
 * manažérov VŠETKÝCH prevádzok, manažér seba a prípadných spoluspravujúcich
 * manažérov tej istej prevádzky, zamestnanec manažéra svojej prevádzky) —
 * žiadna vlastná vetva podľa role, tá istá otázka ("koho v tejto prevádzke
 * môžem vidieť") má vždy tú istú odpoveď.
 */
export async function getKontaktData(user: CurrentUser) {
  return withUserContext(user.id, async (tx) => {
    const [orgRows, owners, managers] = await Promise.all([
      tx.select().from(organizations).where(eq(organizations.id, user.orgId)),
      tx
        .select({ fullName: users.fullName, email: users.email, phone: users.phone })
        .from(users)
        .where(and(eq(users.orgId, user.orgId), eq(users.role, "owner"), eq(users.isActive, true), ne(users.id, user.id))),
      tx
        .selectDistinct({ fullName: users.fullName, email: users.email, phone: users.phone })
        .from(managerWorkplaces)
        .innerJoin(users, eq(users.id, managerWorkplaces.userId))
        .where(
          and(
            eq(users.isActive, true),
            ne(users.id, user.id),
            sql`${managerWorkplaces.workplaceId} IN (SELECT accessible_workplaces())`,
          ),
        ),
    ]);

    const org = orgRows[0] ?? null;
    const support: ContactPerson | null =
      org && (org.supportName || org.supportEmail || org.supportPhone)
        ? { fullName: org.supportName ?? "Podpora", email: org.supportEmail ?? "", phone: org.supportPhone }
        : null;

    return { support, owners, managers };
  });
}

export type KontaktData = Awaited<ReturnType<typeof getKontaktData>>;

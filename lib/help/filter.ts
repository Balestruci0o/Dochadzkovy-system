import type { UserRole } from "@/lib/auth/session";
import type { HelpTopic } from "./types";

/**
 * Každá rola vidí LEN svoj obsah (téma aj jednotlivý článok v nej). Čistá
 * funkcia — volaná zo Server Componentu (`app/(app)/pomoc/page.tsx`) PRED
 * odoslaním čohokoľvek klientovi, nikdy až v prehliadači.
 */
export function filterHelpTopicsForRole(topics: HelpTopic[], role: UserRole): HelpTopic[] {
  return topics
    .filter((t) => t.roles.includes(role))
    .map((t) => ({ ...t, articles: t.articles.filter((a) => a.roles.includes(role)) }))
    .filter((t) => t.articles.length > 0);
}

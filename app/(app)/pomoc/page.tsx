import { HelpBrowser } from "@/components/help/help-browser";
import { requireUser } from "@/lib/auth/session";
import { HELP_TOPICS } from "@/lib/help/content";
import { filterHelpTopicsForRole } from "@/lib/help/filter";

/**
 * Pomocník — každá rola vidí LEN svoj obsah. Filtrovanie
 * beží tu (server), nie v `HelpBrowser` — klient nikdy nedostane do
 * prehliadača ani JSON s článkami inej role.
 */
export default async function PomocPage() {
  const user = await requireUser();
  const topics = filterHelpTopicsForRole(HELP_TOPICS, user.role);

  return <HelpBrowser topics={topics} />;
}

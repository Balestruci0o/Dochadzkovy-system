import { and, eq } from "drizzle-orm";
import type { CurrentUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { notificationPreferences } from "@/lib/db/schema";

/**
 * Opt-out model (rovnaké ako `is_channel_enabled()` v dispatch.ts) — chýbajúci
 * riadok = kanál zapnutý. Vracia LEN riadky, ktoré si používateľ VYPOL.
 */
export async function getMyEmailPreferences(user: CurrentUser): Promise<Record<string, boolean>> {
  return withUserContext(user.id, async (tx) => {
    const rows = await tx
      .select({ kind: notificationPreferences.kind, enabled: notificationPreferences.enabled })
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, user.id), eq(notificationPreferences.channel, "email")));

    const map: Record<string, boolean> = {};
    for (const r of rows) map[r.kind] = r.enabled;
    return map;
  });
}

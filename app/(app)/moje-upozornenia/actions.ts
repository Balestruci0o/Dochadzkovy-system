"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { notificationPreferences } from "@/lib/db/schema";
import type { NotificationKind } from "@/lib/notifications/types";

export async function setEmailPreferenceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "") as NotificationKind;
  const enabled = formData.get("enabled") === "true";
  if (!kind) return;

  await withUserContext(user.id, (tx) =>
    tx
      .insert(notificationPreferences)
      .values({ userId: user.id, kind, channel: "email", enabled })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.kind, notificationPreferences.channel],
        set: { enabled },
      }),
  );

  revalidatePath("/moje-upozornenia");
}

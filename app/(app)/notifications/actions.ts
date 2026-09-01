"use server";

import { and, count, desc, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { withUserContext } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

export type NotificationItem = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export type MyNotifications = { unreadCount: number; items: NotificationItem[] };

/**
 * Blok 11 — volá sa priamo z klienta (zvonček, `NotificationBell`), nie len
 * cez `<form action>` — Server Actions sa dajú volať aj ako obyčajná async
 * funkcia na čítanie (RPC štýl), nielen mutácie. Používa sa aj na
 * jednoduché periodické "pollovanie" (žiadny websocket/SSE zatiaľ).
 */
export async function getMyNotifications(): Promise<MyNotifications> {
  const user = await requireUser();

  return withUserContext(user.id, async (tx) => {
    const [items, unread] = await Promise.all([
      tx.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(20),
      tx.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
    ]);

    return { unreadCount: unread[0]?.n ?? 0, items };
  });
}

/**
 * Zámerne BEZ `revalidatePath` — zvonček si svoj stav (neprečítané/zoznam)
 * spravuje sám na klientovi (`setData` v `NotificationBell`), a inde v appke
 * sa počet neprečítaných nezobrazuje. Revalidácia celého layoutu tu len
 * zbytočne súťažila s prebiehajúcou navigáciou (klik na notifikáciu →
 * <Link>) — reálne nájdené Playwright behom (klik nedonavigoval).
 */
export async function markNotificationReadAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const notificationId = String(formData.get("notificationId") ?? "");
  if (!notificationId) return;

  await withUserContext(user.id, (tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, notificationId), eq(notifications.userId, user.id))),
  );
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();

  await withUserContext(user.id, (tx) =>
    tx.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt))),
  );
}

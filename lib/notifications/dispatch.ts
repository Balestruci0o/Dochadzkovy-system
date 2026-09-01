import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/resend";
import { renderNotificationEmail } from "./render-email";
import type { NotificationKind } from "./types";

type Db = PostgresJsDatabase<typeof schema>;

export type NotificationInput = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: string;
  payload?: Record<string, unknown>;
};

/**
 * Blok 11 — jediné miesto, kade prechádza KAŽDÁ notifikácia, do KTORÉHOKOĽVEK
 * kanála. `lib/notifications/events.ts` ("kedy") volá TOTO a nič iné — nikdy
 * nezapisuje do `notifications`/neposiela email priamo. Vďaka tomu pridanie
 * ĎALŠIEHO kanála (email teraz, push/SMS neskôr) znamená zmenu LEN tu, nie
 * v žiadnom z volajúcich miest (bod 3 zadania) — presne to sa práve stalo:
 * krok 2 (email) pridal kód LEN tu, `events.ts` sa nezmenilo v tom, ČO volá.
 *
 * In-app je VŽDY zapnuté (žiadna preferencia ho nevie vypnúť — bod 4
 * zadania) — zapisuje sa cez `create_notification()` (SECURITY DEFINER,
 * migrácie 0019/0021 — vracia aj príjemcov email, aby ho appka nemusela
 * čítať druhým, RLS-blokovaným dopytom). Email kanál (bod 2) sa riadi
 * `notification_preferences` (opt-out — `is_channel_enabled()`, migrácia
 * 0021) a nikdy nespadne bez RESEND_API_KEY (`sendEmail`, log-fallback).
 */
export async function notify(tx: Db, input: NotificationInput): Promise<void> {
  const rows = await tx.execute<{ notification_id: string; recipient_email: string | null }>(
    sql`SELECT * FROM create_notification(
      ${input.userId}::uuid,
      ${input.kind},
      ${input.title},
      ${input.body ?? null},
      ${input.link ?? null},
      ${input.payload ? JSON.stringify(input.payload) : null}::jsonb
    )`,
  );
  const row = rows[0];
  if (!row?.recipient_email) return; // in-app sa zapísalo vyššie; bez emailu (napr. odstránený účet) niet komu poslať ďalší kanál

  const enabledRows = await tx.execute<{ is_channel_enabled: boolean }>(
    sql`SELECT is_channel_enabled(${input.userId}::uuid, ${input.kind}, 'email')`,
  );
  const emailEnabled = enabledRows[0]?.is_channel_enabled ?? true;
  if (!emailEnabled) return;

  const { subject, html } = renderNotificationEmail(input);
  await sendEmail({ to: row.recipient_email, subject, html });
  await tx.execute(sql`SELECT mark_notification_email_sent(${row.notification_id}::uuid)`);
}

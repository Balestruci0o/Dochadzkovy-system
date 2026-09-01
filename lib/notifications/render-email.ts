import { absenceDecisionEmailHtml, genericNotificationEmailHtml, schedulePublishedEmailHtml } from "@/lib/email/templates";
import type { NotificationInput } from "./dispatch";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

/**
 * Blok 11, krok 2 — mapuje JEDNU notifikáciu (nezávisle od toho, či ide aj
 * in-app) na email predmet+telo. Dve udalosti majú vlastnú, krajšiu šablónu
 * (`payload` nesie štruktúrované dáta z `events.ts`); zvyšok padá na
 * generický fallback (title/body/link) — bod 2 zadania: KAŽDÁ udalosť musí
 * vedieť ísť aj mailom, nielen tie s vlastnou šablónou.
 */
export function renderNotificationEmail(input: NotificationInput): { subject: string; html: string } {
  const link = input.link ? `${APP_URL}${input.link}` : undefined;

  if ((input.kind === "absence_request_approved" || input.kind === "absence_request_rejected") && input.payload) {
    const p = input.payload as { approved: boolean; kindLabel: string; period: string; decisionNote: string | null };
    return {
      subject: input.title,
      html: absenceDecisionEmailHtml({ approved: p.approved, kindLabel: p.kindLabel, period: p.period, decisionNote: p.decisionNote, link: link ?? "" }),
    };
  }

  if (input.kind === "schedule_published" && input.payload) {
    const p = input.payload as { workplaceName: string; year: number; month: number };
    return { subject: input.title, html: schedulePublishedEmailHtml({ workplaceName: p.workplaceName, year: p.year, month: p.month, link: link ?? "" }) };
  }

  return { subject: input.title, html: genericNotificationEmailHtml({ title: input.title, body: input.body ?? null, link: link ?? null }) };
}

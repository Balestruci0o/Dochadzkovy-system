/**
 * "KEDY" vs. "AKO" je zámerne oddelené (bod 3 zadania).
 * `NotificationKind` je jediný zoznam udalostí, ktoré appka pozná — pridanie
 * nového KANÁLA (push/SMS) nikdy nemení tento zoznam, len `dispatch.ts`.
 */
export type NotificationKind =
  | "absence_request_submitted"
  | "absence_request_approved"
  | "absence_request_rejected"
  | "schedule_gap_detected"
  | "schedule_generated"
  | "schedule_published"
  | "punch_correction_requested"
  | "punch_correction_resolved"
  | "punch_corrected_by_manager"
  | "missing_punch_requested"
  | "missing_punch_resolved"
  | "manual_override_applied";

/**
 * Kanály — `email` je jediný implementovaný okrem in-app (ktoré je vždy
 * zapnuté a nemá preferenčný riadok). `push`/`sms` sú tu len ako TYPY, nech
 * ich pridanie neskôr nevyžaduje prepisovanie `NotificationKind`/`events.ts`
 * (bod 5 zadania — architektúra ich nevylučuje, len ešte nie sú implementované).
 */
export type NotificationChannel = "email" | "push" | "sms";

import type { UserRole } from "@/lib/auth/session";
import type { NotificationKind } from "./types";

/**
 * Blok 13, bod 4 — jeden riadok = jeden typ notifikácie, ktorý sa dá vypnúť
 * pre email kanál (in-app je vždy zapnuté, viď dispatch.ts). `roles` hovorí,
 * KOMU sa táto notifikácia vôbec niekedy posiela — nastavenie zobrazí
 * používateľovi len tie riadky, čo sa ho reálne týkajú. 2FA kódy (login-otp)
 * NIE SÚ tu zámerne — idú mimo `notify()`/`notification_preferences`
 * úplne (lib/auth/email-otp.ts), takže sa nedajú vypnúť nikde v appke.
 */
export const NOTIFICATION_KIND_INFO: Record<NotificationKind, { label: string; roles: UserRole[] }> = {
  absence_request_submitted: { label: "Nová žiadosť o dovolenku/PN/OČR/paragraf", roles: ["owner", "manager"] },
  schedule_gap_detected: { label: "Diera v rozvrhu po vygenerovaní", roles: ["owner", "manager"] },
  schedule_generated: { label: "Rozvrh pripravený na kontrolu", roles: ["owner", "manager"] },
  punch_correction_requested: { label: "Žiadosť o opravu razítka", roles: ["owner", "manager"] },
  missing_punch_requested: { label: "Žiadosť o pridanie chýbajúceho pípnutia", roles: ["owner", "manager"] },
  manual_override_applied: { label: "Manuálne priradenie napriek porušeniu pravidla", roles: ["owner", "manager"] },
  absence_request_approved: { label: "Moja žiadosť bola schválená", roles: ["employee"] },
  absence_request_rejected: { label: "Moja žiadosť bola zamietnutá", roles: ["employee"] },
  schedule_published: { label: "Nový rozvrh zverejnený", roles: ["employee"] },
  punch_correction_resolved: { label: "Moja žiadosť o opravu razítka vybavená", roles: ["employee"] },
  punch_corrected_by_manager: { label: "Manažér priamo opravil moju dochádzku", roles: ["employee"] },
  missing_punch_resolved: { label: "Moja žiadosť o chýbajúce pípnutie vybavená", roles: ["employee"] },
};

export function notificationKindsForRole(role: UserRole): NotificationKind[] {
  return (Object.keys(NOTIFICATION_KIND_INFO) as NotificationKind[]).filter((k) =>
    NOTIFICATION_KIND_INFO[k].roles.includes(role),
  );
}

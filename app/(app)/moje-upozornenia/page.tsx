import { EmailPreferencesList } from "@/components/notifications/email-preferences-list";
import { requireUser } from "@/lib/auth/session";
import { NOTIFICATION_KIND_INFO, notificationKindsForRole } from "@/lib/notifications/kind-labels";
import { getMyEmailPreferences } from "./data";

export default async function MojeUpozorneniaPage() {
  const user = await requireUser();
  const preferences = await getMyEmailPreferences(user);
  const kinds = notificationKindsForRole(user.role).map((k) => ({ kind: k, label: NOTIFICATION_KIND_INFO[k].label }));

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <h2 className="mb-1 font-serif text-lg font-bold text-ink">Emailové upozornenia</h2>
      <p className="mb-4 text-sm text-ink-soft">
        Upozornenie v appke (zvonček) dostaneš vždy. Tu si vyber, o čom navyše chceš aj email. Kód na dvojfaktorové
        overenie chodí vždy, nedá sa vypnúť.
      </p>
      {kinds.length === 0 ? (
        <p className="text-sm text-ink-faint">Pre tvoju rolu zatiaľ nie sú žiadne nastaviteľné upozornenia.</p>
      ) : (
        <EmailPreferencesList kinds={kinds} preferences={preferences} />
      )}
    </div>
  );
}

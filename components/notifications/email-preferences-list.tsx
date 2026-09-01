"use client";

import { Loader2 } from "lucide-react";
import { setEmailPreferenceAction } from "@/app/(app)/moje-upozornenia/actions";
import { SubmitButton } from "@/components/ui/submit-button";

function ToggleRow({ kind, label, enabled }: { kind: string; label: string; enabled: boolean }) {
  return (
    <form action={setEmailPreferenceAction} className="flex items-center justify-between gap-3 rounded-md border border-line p-3.5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <span className="text-sm text-ink">{label}</span>
      <SubmitButton
        aria-label={enabled ? `Vypnúť email pre: ${label}` : `Zapnúť email pre: ${label}`}
        className={`relative h-6 w-11 flex-none rounded-full border transition-colors duration-200 disabled:opacity-60 ${enabled ? "border-orange bg-orange" : "border-line bg-cream-2"}`}
        pendingContent={<Loader2 size={13} className="mx-auto animate-spin text-ink-faint" />}
      >
        <span
          className={`absolute inset-y-0.5 left-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform duration-200 ${enabled ? "translate-x-5" : "translate-x-0"}`}
        />
      </SubmitButton>
    </form>
  );
}

export function EmailPreferencesList({
  kinds,
  preferences,
}: {
  kinds: { kind: string; label: string }[];
  preferences: Record<string, boolean>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {kinds.map((k) => (
        // Chýbajúci riadok v `notification_preferences` = zapnuté (opt-out model,
        // rovnaké ako `is_channel_enabled()`), preto `?? true`.
        <ToggleRow key={k.kind} kind={k.kind} label={k.label} enabled={preferences[k.kind] ?? true} />
      ))}
    </div>
  );
}

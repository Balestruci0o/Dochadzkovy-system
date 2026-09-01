"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { setEmployeePasswordAction, type EmployeeFormState } from "@/app/(app)/zamestnanci/actions";

const initialState: EmployeeFormState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

/**
 * Alternatíva k "Pozvať do systému" (email/pozvánkový tok) — owner/manažér
 * zadá heslo priamo, žiadny email neodíde. Konto vznikne hneď aktívne
 * (`setEmployeePasswordAction` → `createEmployeeAccountWithPassword`).
 */
export function SetEmployeePasswordButton({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(setEmployeePasswordAction, initialState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-cream-2"
      >
        <KeyRound size={15} /> Nastaviť heslo teraz
      </button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-2 rounded-md border border-line-soft bg-cream-2 p-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-ink">
          Heslo
          {/* minLength zámerne zhoduje s lib/auth/password.ts MIN_LENGTH (nie exportované, viď set-password-form.tsx) */}
          <input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink">
          Potvrdenie hesla
          <input name="passwordConfirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
        </label>
      </div>
      <p className="text-[11px] leading-snug text-ink-faint">
        Aspoň 12 znakov. Konto bude hneď aktívne — heslo povedz zamestnancovi osobne, žiadny email neodíde.
      </p>
      {state.error && <p className="text-xs text-late">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-1.5 rounded-md bg-orange px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
        >
          {pending && <Loader2 size={12} className="animate-spin" />}
          {pending ? "Vytváram…" : "Vytvoriť konto"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs font-semibold text-ink-soft hover:underline">
          Zrušiť
        </button>
      </div>
    </form>
  );
}

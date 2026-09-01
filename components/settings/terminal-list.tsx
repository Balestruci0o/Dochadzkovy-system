"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useActionState, useState } from "react";
import {
  createTerminalAction,
  regenerateTerminalSecretAction,
  toggleTerminalActiveAction,
  type ActionState,
} from "@/app/(app)/nastavenia/terminaly/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { TerminalSecretReveal } from "./terminal-secret-reveal";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

export type ExistingTerminal = {
  id: string;
  workplaceId: string;
  name: string;
  deviceId: string;
  lastSeenAt: string | Date | null;
  isActive: boolean;
};

function CreateTerminalForm({
  workplaceOptions,
  onClose,
}: {
  workplaceOptions: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(createTerminalAction, initialState);

  if (state.success && state.plaintextSecret) {
    return <TerminalSecretReveal secret={state.plaintextSecret} onClose={onClose} />;
  }

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Prevádzka
            <select name="workplaceId" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                — vyber prevádzku —
              </option>
              {workplaceOptions.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Názov
            <input name="name" required placeholder="Recepcia hotel" className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Device ID (HW identifikátor ESP32)
          <input name="deviceId" required className={inputClass} />
        </label>

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Registrujem…" : "Zaregistrovať a vygenerovať prístupový kľúč"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
          >
            Zrušiť
          </button>
        </div>
      </div>
    </form>
  );
}

function RegenerateButton({ terminalId }: { terminalId: string }) {
  const [state, formAction, pending] = useActionState(regenerateTerminalSecretAction, initialState);
  const [confirming, setConfirming] = useState(false);

  if (state.success && state.plaintextSecret) {
    return <TerminalSecretReveal secret={state.plaintextSecret} onClose={() => setConfirming(false)} />;
  }

  if (confirming) {
    return (
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="id" value={terminalId} />
        <span className="text-xs text-late">Starý prístupový kľúč prestane fungovať okamžite. Naozaj?</span>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-late px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Generujem…" : "Áno, vygenerovať nové"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-cream-2"
        >
          Nie
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
    >
      <RefreshCw size={14} /> Prístupový kľúč
    </button>
  );
}

export function TerminalList({
  terminals,
  workplaceOptions,
}: {
  terminals: ExistingTerminal[];
  workplaceOptions: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Terminály</h3>
        {!adding && workplaceOptions.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Nový terminál
          </button>
        )}
      </div>

      {workplaceOptions.length === 0 && (
        <p className="text-sm text-ink-faint">Najprv pridaj aspoň jednu prevádzku v záložke Prevádzky.</p>
      )}

      {adding && <CreateTerminalForm workplaceOptions={workplaceOptions} onClose={() => setAdding(false)} />}

      <div className="flex flex-col gap-2">
        {terminals.map((t) => {
          const workplaceName = workplaceOptions.find((w) => w.id === t.workplaceId)?.name;
          return (
            <div
              key={t.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3.5 ${!t.isActive ? "opacity-50" : ""}`}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-sm font-semibold text-ink">{t.name}</b>
                  <span className="text-xs text-ink-faint">{workplaceName}</span>
                  {!t.isActive && (
                    <span className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                      Neaktívny
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {t.deviceId} ·{" "}
                  {t.lastSeenAt
                    ? `naposledy videný ${new Date(t.lastSeenAt).toLocaleString("sk-SK")}`
                    : "ešte sa nehlásil"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <RegenerateButton terminalId={t.id} />
                <form action={toggleTerminalActiveAction}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="nextActive" value={t.isActive ? "false" : "true"} />
                  <SubmitButton
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                    pendingContent={<Loader2 size={14} className="animate-spin" />}
                  >
                    {t.isActive ? "Deaktivovať" : "Aktivovať"}
                  </SubmitButton>
                </form>
              </div>
            </div>
          );
        })}
        {terminals.length === 0 && !adding && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadny terminál.</p>
        )}
      </div>
    </div>
  );
}

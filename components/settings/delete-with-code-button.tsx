"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useActionState, useEffect, useState } from "react";

type ConfirmState = { error?: string; success?: boolean };
const initialState: ConfirmState = {};

/**
 * Blok 14 — zdieľané UI pre "Zmazať" naprieč §ZP pravidlami, pokrytím,
 * šablónami zmien, pozíciami a prevádzkami. Tri kroky: ikonka koša →
 * potvrdenie úmyslu + "Poslať kód" → vlož kód + "Potvrdiť zmazanie". Samotná
 * logika (poslať/overiť kód, zmazať, rozlíšiť FK chybu) je v `requestAction`/
 * `confirmAction`, ktoré dodáva KAŽDÁ entita zvlášť (iná tabuľka, iná
 * hláška pri závislosti) — táto komponenta rieši len interakciu.
 */
export function DeleteWithCodeButton({
  id,
  label,
  requestAction,
  confirmAction,
}: {
  id: string;
  label: string;
  requestAction: (formData: FormData) => Promise<{ error?: string }>;
  confirmAction: (prev: ConfirmState, formData: FormData) => Promise<ConfirmState>;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "code">("idle");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(confirmAction, initialState);

  useEffect(() => {
    if (state.success) setStep("idle");
  }, [state.success]);

  async function handleSendCode() {
    setSending(true);
    setSendError(null);
    const fd = new FormData();
    fd.set("id", id);
    const result = await requestAction(fd);
    setSending(false);
    if (result?.error) {
      setSendError(result.error);
      return;
    }
    setStep("code");
  }

  if (step === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStep("confirm")}
        aria-label={`Zmazať ${label}`}
        className="rounded-md border border-line p-1.5 text-ink-faint transition hover:bg-late-tint hover:text-late"
      >
        <Trash2 size={15} />
      </button>
    );
  }

  if (step === "confirm") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-late/40 bg-late-tint p-2.5">
        <span className="text-xs text-late">Natrvalo zmazať „{label}“? Pošleme ti potvrdzovací kód na email.</span>
        <button
          type="button"
          disabled={sending}
          onClick={handleSendCode}
          className="rounded-md bg-late px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {sending ? "Posielam kód…" : "Poslať kód"}
        </button>
        <button type="button" onClick={() => setStep("idle")} className="text-xs font-semibold text-ink-soft hover:underline">
          Zrušiť
        </button>
        {sendError && <span className="w-full text-xs text-late">{sendError}</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-md border border-late/40 bg-late-tint p-2.5">
      <input type="hidden" name="id" value={id} />
      <span className="text-xs text-late">Kód poslaný na email — zadaj ho:</span>
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        placeholder="123456"
        required
        autoFocus
        className="w-24 rounded border border-line bg-paper px-2 py-1 text-sm tracking-widest text-ink outline-none focus:border-late"
      />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md bg-late px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending && <Loader2 size={12} className="animate-spin" />}
        {pending ? "Mažem…" : "Potvrdiť zmazanie"}
      </button>
      <button type="button" onClick={() => setStep("idle")} className="text-xs font-semibold text-ink-soft hover:underline">
        Zrušiť
      </button>
      {state.error && <span className="w-full text-xs text-late">{state.error}</span>}
    </form>
  );
}

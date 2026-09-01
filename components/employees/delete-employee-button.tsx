"use client";

import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";
import type { DeleteEmployeeState } from "@/app/(app)/zamestnanci/[id]/actions";
import type { EmployeeDeletionSummary } from "@/app/(app)/zamestnanci/[id]/data";

const initialState: DeleteEmployeeState = {};

const inputClass = "w-24 rounded border border-line bg-paper px-2 py-1 text-sm tracking-widest text-ink outline-none focus:border-late";

function summaryRows(summary: EmployeeDeletionSummary, hasAccount: boolean): { label: string; count: number }[] {
  return [
    { label: "Pípnutia (príchody/odchody)", count: summary.punchEventsCount },
    { label: "Odpracované dni (dochádzka)", count: summary.attendanceDaysCount },
    { label: "Naplánované smeny v rozvrhu", count: summary.scheduledShiftsCount },
    { label: "Žiadosti o dovolenku/PN/OČR", count: summary.absenceRequestsCount },
    { label: "História pozícií", count: summary.positionHistoryCount },
    { label: "História sadzieb", count: summary.rateHistoryCount },
    ...(hasAccount ? [{ label: "Prihlasovacie konto", count: 1 }] : []),
  ];
}

/**
 * Blok 14, bod 3 — mazanie zamestnanca, VRÁTANE pípnutí (vedomé rozhodnutie
 * ownera). Na rozdiel od `DeleteWithCodeButton`
 * (config entity) tento krok navyše ukáže PREHĽAD DÔSLEDKOV pred odoslaním
 * kódu — hlavne počet pípnutí, keďže presne TOTO doteraz platilo ako
 * absolútne nezmazateľné.
 */
export function DeleteEmployeeButton({
  employeeId,
  employeeName,
  summary,
  hasAccount,
  requestAction,
  confirmAction,
}: {
  employeeId: string;
  employeeName: string;
  summary: EmployeeDeletionSummary;
  hasAccount: boolean;
  requestAction: (formData: FormData) => Promise<{ error?: string }>;
  confirmAction: (prev: DeleteEmployeeState, formData: FormData) => Promise<DeleteEmployeeState>;
}) {
  const [step, setStep] = useState<"idle" | "confirm" | "code">("idle");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(confirmAction, initialState);

  async function handleSendCode() {
    setSending(true);
    setSendError(null);
    const fd = new FormData();
    fd.set("employeeId", employeeId);
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
        className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-late transition hover:bg-late-tint"
      >
        <Trash2 size={15} /> Zmazať natrvalo
      </button>
    );
  }

  const rows = summaryRows(summary, hasAccount);

  if (step === "confirm") {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-late/40 bg-late-tint p-4">
        <div className="flex items-start gap-2 text-sm font-semibold text-late">
          <TriangleAlert size={18} className="mt-0.5 flex-none" />
          <span>Natrvalo zmazať „{employeeName}“? Toto sa NEDÁ vrátiť späť.</span>
        </div>
        <ul className="flex flex-col gap-1 rounded-md border border-late/30 bg-paper p-3 text-sm text-ink-soft">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-3">
              <span>{r.label}</span>
              <span className={`font-semibold tabular-nums ${r.count > 0 ? "text-late" : "text-ink-faint"}`}>{r.count}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-ink-soft">
          Pošleme ti potvrdzovací kód na email — rovnaký princíp ako pri ostatných mazaniach.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={sending}
            onClick={handleSendCode}
            className="rounded-md bg-late px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {sending ? "Posielam kód…" : "Poslať kód"}
          </button>
          <button type="button" onClick={() => setStep("idle")} className="text-sm font-semibold text-ink-soft hover:underline">
            Zrušiť
          </button>
        </div>
        {sendError && <span className="text-xs text-late">{sendError}</span>}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-md border border-late/40 bg-late-tint p-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <span className="text-sm text-late">Kód poslaný na email — zadaj ho:</span>
      <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" required autoFocus className={inputClass} />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 rounded-md bg-late px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {pending && <Loader2 size={12} className="animate-spin" />}
        {pending ? "Mažem…" : "Potvrdiť trvalé zmazanie"}
      </button>
      <button type="button" onClick={() => setStep("idle")} className="text-sm font-semibold text-ink-soft hover:underline">
        Zrušiť
      </button>
      {state.error && <span className="w-full text-xs text-late">{state.error}</span>}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { verifyStepUpAction, type StepUpState } from "./actions";

const initialState: StepUpState = {};

export function VerifyForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(verifyStepUpAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="flex flex-col gap-1 text-sm text-ink">
        Overovací kód
        <input
          type="text"
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoComplete="one-time-code"
          className="rounded-md border border-line bg-paper px-3 py-2 tracking-widest text-ink outline-none focus:border-orange"
        />
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Overujem…" : "Potvrdiť"}
      </button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ResetRequestState } from "./actions";

const initialState: ResetRequestState = {};

export function ResetRequestForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state.submitted) {
    return (
      <p className="text-sm text-ink">
        Ak email v systéme existuje, poslali sme naň odkaz na obnovu hesla.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        />
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Odosielam…" : "Poslať odkaz na obnovu"}
      </button>
    </form>
  );
}

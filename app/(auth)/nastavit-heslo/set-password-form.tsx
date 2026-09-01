"use client";

import { useActionState } from "react";
import { setPasswordAction, type SetPasswordState } from "./actions";

const initialState: SetPasswordState = {};

export function SetPasswordForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(setPasswordAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? "/"} />
      <label className="flex flex-col gap-1 text-sm text-ink">
        Nové heslo
        <input
          type="password"
          name="password"
          required
          minLength={12}
          autoComplete="new-password"
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Zopakuj heslo
        <input
          type="password"
          name="passwordConfirm"
          required
          minLength={12}
          autoComplete="new-password"
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        />
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Ukladám…" : "Nastaviť heslo"}
      </button>
    </form>
  );
}

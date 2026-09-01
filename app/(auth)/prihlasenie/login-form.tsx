"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initialState: LoginState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? "/"} />
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
      <label className="flex flex-col gap-1 text-sm text-ink">
        Heslo
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        />
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Prihlasujem…" : "Prihlásiť sa"}
      </button>
      <a href="/obnova-hesla" className="text-sm text-ink-soft underline">
        Zabudol/a som heslo
      </a>
    </form>
  );
}

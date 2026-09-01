"use client";

import { useActionState } from "react";
import { inviteUserAction, type InviteState } from "./actions";

const initialState: InviteState = {};

export function InviteForm({ canInviteManagers }: { canInviteManagers: boolean }) {
  const [state, formAction, pending] = useActionState(inviteUserAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm text-ink">
        Meno a priezvisko
        <input
          type="text"
          name="fullName"
          required
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Email
        <input
          type="email"
          name="email"
          required
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Rola
        <select
          name="role"
          defaultValue="employee"
          className="rounded-md border border-line bg-paper px-3 py-2 text-ink outline-none focus:border-orange"
        >
          <option value="employee">Zamestnanec</option>
          {canInviteManagers && <option value="manager">Manažér</option>}
          {canInviteManagers && <option value="accountant">Účtovníčka</option>}
        </select>
      </label>
      {state.error && <p className="text-sm text-late">{state.error}</p>}
      {state.success && <p className="text-sm text-ok">{state.success}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-orange px-4 py-2 font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Odosielam pozvánku…" : "Poslať pozvánku"}
      </button>
    </form>
  );
}

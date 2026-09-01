"use client";

import { useActionState, useState } from "react";
import { createEmployeeAction, type EmployeeFormState } from "@/app/(app)/zamestnanci/actions";

const initialState: EmployeeFormState = {};

const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

export function EmployeeCreateForm({
  workplaces,
  positions,
  canSetRate,
}: {
  workplaces: { id: string; name: string }[];
  positions: { id: string; name: string }[];
  canSetRate: boolean;
}) {
  const [state, formAction, pending] = useActionState(createEmployeeAction, initialState);
  const today = new Date().toISOString().slice(0, 10);
  const [email, setEmail] = useState("");
  const [accountMode, setAccountMode] = useState<"invite" | "password" | "none">("invite");

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Meno
          <input name="firstName" required className={inputClass} />
        </label>
        <label className={labelClass}>
          Priezvisko
          <input name="lastName" required className={inputClass} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Telefón
          <input name="phone" type="tel" className={inputClass} />
        </label>
        <label className={labelClass}>
          Email
          <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </label>
      </div>

      {email.trim() && (
        <div className="flex flex-col gap-2 rounded-md border border-line-soft bg-cream-2 p-3 text-sm text-ink">
          <input type="hidden" name="accountMode" value={accountMode} />
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={accountMode === "invite"}
              onChange={() => setAccountMode("invite")}
              className="mt-0.5 accent-orange"
            />
            <span>
              Poslať pozvánku emailom
              <span className="block text-xs text-ink-faint">
                Zamestnanec dostane email s odkazom na nastavenie hesla.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={accountMode === "password"}
              onChange={() => setAccountMode("password")}
              className="mt-0.5 accent-orange"
            />
            <span>
              Nastaviť heslo teraz
              <span className="block text-xs text-ink-faint">
                Zadáš heslo priamo, konto bude hneď aktívne. Žiadny email neodíde — heslo povedz
                zamestnancovi osobne.
              </span>
            </span>
          </label>
          {accountMode === "password" && (
            <div className="grid grid-cols-1 gap-3 pl-6 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-ink">
                Heslo
                <input name="password" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink">
                Potvrdenie hesla
                <input name="passwordConfirm" type="password" required minLength={12} autoComplete="new-password" className={inputClass} />
              </label>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input
              type="radio"
              checked={accountMode === "none"}
              onChange={() => setAccountMode("none")}
              className="mt-0.5 accent-orange"
            />
            <span>
              Bez konta
              <span className="block text-xs text-ink-faint">
                Zamestnanec sa do systému neprihlasuje (napr. len na výkazy).
              </span>
            </span>
          </label>
        </div>
      )}

      <label className={labelClass}>
        Osobné číslo
        <span className="text-xs font-normal text-ink-faint">Číslo zamestnanca v mzdovom systéme</span>
        <input name="personalNumber" className={inputClass} />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Dátum nástupu
          <input name="hiredOn" type="date" required defaultValue={today} className={inputClass} />
        </label>
        <label className={labelClass}>
          Nárok na dovolenku (dní/rok)
          <input
            name="vacationDaysPerYear"
            type="number"
            step="0.5"
            min="0"
            defaultValue={20}
            className={inputClass}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Úväzok (hodín/mesiac)
          <input name="contractHoursPerMonth" type="number" step="0.5" min="0" className={inputClass} />
        </label>
        <label className={labelClass}>
          Typ úväzku
          <select name="contractType" className={inputClass} defaultValue="">
            <option value="">— nevybraté —</option>
            <option value="plny">Plný úväzok</option>
            <option value="skrateny">Skrátený úväzok</option>
            <option value="dohoda">Dohoda</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Prevádzka
          <select name="workplaceId" required className={inputClass} defaultValue="">
            <option value="" disabled>
              — vyber prevádzku —
            </option>
            {workplaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Pozícia
          <select name="positionId" className={inputClass} defaultValue="">
            <option value="">— nevybraté —</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canSetRate && (
        <label className={labelClass}>
          Hodinová sadzba (€/h) — voliteľné, môžeš doplniť aj neskôr
          <input name="hourlyRate" type="number" step="0.01" min="0" className={inputClass} />
        </label>
      )}

      {state.error && <p className="text-sm text-late">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-orange px-5 py-2.5 font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Ukladám…" : "Pridať zamestnanca"}
      </button>
    </form>
  );
}

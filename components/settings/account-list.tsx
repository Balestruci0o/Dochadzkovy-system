"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  assignManagerWorkplaceAction,
  confirmDeleteUserAccountAction,
  createOwnerOrManagerAccountAction,
  requestDeleteUserAccountCodeAction,
  resendAccountInviteAction,
  toggleAccountActiveAction,
  unassignManagerWorkplaceAction,
  updateAccountPhoneAction,
  updateManagerPermissionsAction,
  updateSupportContactAction,
  type ActionState,
} from "@/app/(app)/nastavenia/konta/actions";
import type { AccountRow, KontaData } from "@/app/(app)/nastavenia/konta/data";
import { ROLE_LABELS } from "@/components/layout/nav-config";
import { DeleteWithCodeButton } from "@/components/settings/delete-with-code-button";
import { SubmitButton } from "@/components/ui/submit-button";

const initialState: ActionState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

function SupportContactForm({ support }: { support: KontaData["support"] }) {
  const [state, formAction, pending] = useActionState(updateSupportContactAction, initialState);

  return (
    <form action={formAction} className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <h3 className="mb-1 font-serif text-lg font-bold text-ink">Kontakt na podporu</h3>
      <p className="mb-4 text-xs text-ink-faint">
        Zobrazuje sa všetkým na stránke Kontakt — nie je viazané na žiadne konto v systéme (dodávateľ/údržba appky).
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Meno
          <input name="supportName" defaultValue={support?.supportName ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Email
          <input name="supportEmail" type="email" defaultValue={support?.supportEmail ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Telefón
          <input name="supportPhone" type="tel" defaultValue={support?.supportPhone ?? ""} className={inputClass} />
        </label>
      </div>
      {state.error && <p className="mt-3 text-sm text-late">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
      >
        {pending ? "Ukladám…" : "Uložiť"}
      </button>
    </form>
  );
}

function CreateAccountForm({
  workplaceOptions,
  onDone,
  isOwner,
}: {
  workplaceOptions: { id: string; name: string }[];
  onDone: () => void;
  isOwner: boolean;
}) {
  const [state, formAction, pending] = useActionState(createOwnerOrManagerAccountAction, initialState);
  const [role, setRole] = useState<"manager" | "owner" | "accountant">("manager");
  const [accountMode, setAccountMode] = useState<"invite" | "password">("invite");

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDone je stabilný z rodiča, sledujeme len úspech akcie
  }, [state.success]);

  return (
    <form action={formAction} className="rounded-md border border-line bg-cream p-4">
      <div className="flex flex-col gap-4">
        <div>
          <span className="mb-1.5 block text-sm font-semibold text-ink">Rola</span>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint">
              <input type="radio" name="role" value="manager" checked={role === "manager"} onChange={() => setRole("manager")} className="accent-orange" />
              Manažér
            </label>
            <label className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint">
              <input type="radio" name="role" value="accountant" checked={role === "accountant"} onChange={() => setRole("accountant")} className="accent-orange" />
              Účtovníčka
            </label>
            {/* Majiteľské konto smie vytvoriť LEN majiteľ — pre povoleného manažéra (manage_accounts) sa táto voľba vôbec nezobrazí, nie je len skrytá/disabled (RLS by ju aj tak zamietla). */}
            {isOwner && (
              <label className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint">
                <input type="radio" name="role" value="owner" checked={role === "owner"} onChange={() => setRole("owner")} className="accent-orange" />
                Majiteľ
              </label>
            )}
          </div>
          {role === "owner" && (
            <p className="mt-1.5 text-xs text-ink-faint">Majiteľ vidí a môže spravovať úplne všetko, rovnako ako ty — vrátane ďalších kont.</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Meno a priezvisko
            <input name="fullName" required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Email
            <input name="email" type="email" required className={inputClass} />
          </label>
        </div>
        <label className="flex max-w-xs flex-col gap-1 text-sm text-ink">
          Telefón (voliteľné)
          <input name="phone" type="tel" className={inputClass} />
        </label>

        {role === "manager" && (
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-ink">Prevádzky, ktoré bude spravovať</span>
            {workplaceOptions.length === 0 ? (
              <p className="text-sm text-ink-faint">Najprv pridaj aspoň jednu prevádzku v Nastaveniach.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {workplaceOptions.map((w) => (
                  <label
                    key={w.id}
                    className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint"
                  >
                    <input type="checkbox" name="workplaceIds" value={w.id} className="accent-orange" />
                    {w.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-md border border-line-soft bg-cream-2 p-3 text-sm text-ink">
          <input type="hidden" name="accountMode" value={accountMode} />
          <label className="flex items-start gap-2">
            <input type="radio" checked={accountMode === "invite"} onChange={() => setAccountMode("invite")} className="mt-0.5 accent-orange" />
            <span>
              Poslať pozvánku emailom
              <span className="block text-xs text-ink-faint">Dostane email s odkazom na nastavenie hesla.</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" checked={accountMode === "password"} onChange={() => setAccountMode("password")} className="mt-0.5 accent-orange" />
            <span>
              Nastaviť heslo teraz
              <span className="block text-xs text-ink-faint">
                Zadáš heslo priamo, konto bude hneď aktívne. Žiadny email neodíde — heslo povedz osobne.
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
        </div>

        {state.error && <p className="text-sm text-late">{state.error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
          >
            {pending ? "Vytváram…" : "Vytvoriť konto"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
          >
            Zrušiť
          </button>
        </div>
      </div>
    </form>
  );
}

function PhoneField({ account }: { account: AccountRow }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <form
        action={async (fd) => {
          await updateAccountPhoneAction(fd);
          setEditing(false);
        }}
        className="flex items-center gap-1.5"
      >
        <input type="hidden" name="userId" value={account.id} />
        <input
          name="phone"
          type="tel"
          defaultValue={account.phone ?? ""}
          autoFocus
          placeholder="telefón"
          className="w-32 rounded border border-line bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-orange"
        />
        <button type="submit" className="text-xs font-semibold text-orange hover:underline">
          Uložiť
        </button>
      </form>
    );
  }

  return (
    <button type="button" onClick={() => setEditing(true)} className="text-xs text-ink-soft hover:text-ink hover:underline">
      {account.phone ?? "+ pridať telefón"}
    </button>
  );
}

function WorkplacesField({ account, workplaceOptions }: { account: AccountRow; workplaceOptions: { id: string; name: string }[] }) {
  const [adding, setAdding] = useState(false);
  const assignedIds = new Set(account.managedWorkplaces.map((w) => w.id));
  const available = workplaceOptions.filter((w) => !assignedIds.has(w.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {account.managedWorkplaces.map((w) => (
        <span key={w.id} className="flex items-center gap-1 rounded-full bg-sage-tint px-2 py-0.5 text-xs font-medium text-sage-dark">
          {w.name}
          <form action={unassignManagerWorkplaceAction}>
            <input type="hidden" name="userId" value={account.id} />
            <input type="hidden" name="workplaceId" value={w.id} />
            <SubmitButton className="text-sage-dark/70 hover:text-late" aria-label={`Odobrať ${w.name}`} pendingContent={<Loader2 size={11} className="animate-spin" />}>
              <X size={11} />
            </SubmitButton>
          </form>
        </span>
      ))}
      {available.length > 0 &&
        (adding ? (
          <form action={assignManagerWorkplaceAction} onSubmit={() => setAdding(false)} className="flex items-center gap-1">
            <input type="hidden" name="userId" value={account.id} />
            <select name="workplaceId" required defaultValue="" className="rounded border border-line bg-paper px-1.5 py-0.5 text-xs" autoFocus>
              <option value="" disabled>
                — vyber —
              </option>
              {available.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <button type="submit" className="text-xs font-semibold text-orange hover:underline">
              Pridať
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="text-xs font-semibold text-orange hover:underline">
            + prevádzka
          </button>
        ))}
    </div>
  );
}

/**
 * Fázy 2-3 — 4 z 6 balíčkov, tie ktoré sú doteraz reálne zapojené (RLS +
 * requirePermission na dotknutých stránkach/akciách). viewWages/editWages
 * (Fáza 4) pribudnú, keď bude ich RLS hotová — zobraziť prepínač, ktorý
 * ešte nič nerobí, by len mýlilo.
 */
const SETTINGS_PERMISSION_FIELDS: { key: "managePositionsShifts" | "manageRules" | "manageTerminals" | "manageAccounts"; label: string }[] = [
  { key: "managePositionsShifts", label: "Pozície a šablóny smien" },
  { key: "manageRules", label: "Pravidlá, pokrytie, zatvorenia" },
  { key: "manageTerminals", label: "Terminály" },
  { key: "manageAccounts", label: "Kontá (manažér/účtovníčka, deaktivácia zamestnancov)" },
];

function PermissionsField({ account }: { account: AccountRow }) {
  return (
    <form action={updateManagerPermissionsAction} className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <input type="hidden" name="userId" value={account.id} />
      <span className="text-xs font-semibold text-ink-soft">Pravomoci v Nastaveniach:</span>
      {SETTINGS_PERMISSION_FIELDS.map((f) => (
        <label key={f.key} className="flex items-center gap-1.5 text-xs text-ink">
          <input
            type="checkbox"
            name={f.key}
            defaultChecked={account.permissions[f.key]}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="accent-orange"
          />
          {f.label}
        </label>
      ))}
    </form>
  );
}

function AccountCard({
  account,
  workplaceOptions,
  isSelf,
  isOwner,
}: {
  account: AccountRow;
  workplaceOptions: { id: string; name: string }[];
  isSelf: boolean;
  isOwner: boolean;
}) {
  // Fáza 3 — manažér s manage_accounts smie prepnúť VÝHRADNE zamestnanecké
  // konto (RLS users_update_manage_accounts, migrácia 0049, by aj tak
  // zamietla čokoľvek iné — toto len nezobrazí tlačidlo, čo by rovnako zlyhalo).
  const canToggleActive = isOwner || account.role === "employee";

  return (
    <div className={`rounded-md border border-line p-3.5 ${!account.isActive ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-sm font-semibold text-ink">{account.fullName}</b>
            <span className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
              {ROLE_LABELS[account.role]}
            </span>
            {!account.isActive && (
              <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-late">Neaktívny</span>
            )}
            {account.isActive && !account.activatedAt && (
              <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                Čaká na aktiváciu
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
            <span>{account.email}</span>
            <PhoneField account={account} />
          </div>
          {/* Priraďovanie prevádzok a editovanie pravomocí ostávajú VÝHRADNE
              majiteľské — anti-eskalácia (Fáza 1) aj mimo rozsahu tejto fázy
              (viď migrácia 0049, "ZÁMERNE MIMO ROZSAHU"). */}
          {account.role === "manager" && isOwner && (
            <div className="mt-2">
              <WorkplacesField account={account} workplaceOptions={workplaceOptions} />
              <PermissionsField account={account} />
            </div>
          )}
        </div>

        <div className="flex flex-none flex-wrap items-center gap-1.5">
          {/* Opätovné poslanie pozvánky ostáva majiteľské — nebolo v zadaní pre manage_accounts. */}
          {isOwner && account.isActive && !account.activatedAt && (
            <form action={resendAccountInviteAction}>
              <input type="hidden" name="userId" value={account.id} />
              <SubmitButton
                className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                pendingContent={<Loader2 size={13} className="animate-spin" />}
              >
                Poslať znova
              </SubmitButton>
            </form>
          )}
          {!isSelf && canToggleActive && (
            <form action={toggleAccountActiveAction}>
              <input type="hidden" name="userId" value={account.id} />
              <input type="hidden" name="nextActive" value={account.isActive ? "false" : "true"} />
              <SubmitButton
                className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                pendingContent={<Loader2 size={13} className="animate-spin" />}
              >
                {account.isActive ? "Deaktivovať" : "Aktivovať"}
              </SubmitButton>
            </form>
          )}
          {/* Mazanie ostáva výhradne majiteľské — nebolo v zadaní pre manage_accounts. */}
          {!isSelf && isOwner && (
            <DeleteWithCodeButton
              id={account.id}
              label={account.fullName}
              requestAction={requestDeleteUserAccountCodeAction}
              confirmAction={confirmDeleteUserAccountAction}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountList({ data, currentUserId, isOwner }: { data: KontaData; currentUserId: string; isOwner: boolean }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      {/* Kontakt na podporu (org-wide nastavenie) ostáva výhradne majiteľský — mimo rozsahu manage_accounts. */}
      {isOwner && <SupportContactForm support={data.support} />}

      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="font-serif text-lg font-bold text-ink">Kontá</h3>
            <p className="text-xs text-ink-faint">
              {isOwner ? "Všetky kontá v organizácii — majiteľ, manažéri, zamestnanci, účtovníčka." : "Manažéri, účtovníčka a zamestnanci vo vašej organizácii."}
            </p>
          </div>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
            >
              <Plus size={16} /> Nové konto
            </button>
          )}
        </div>

        {creating && (
          <div className="mb-4">
            <CreateAccountForm workplaceOptions={data.allWorkplaces} onDone={() => setCreating(false)} isOwner={isOwner} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {data.accounts.map((a) => (
            <AccountCard key={a.id} account={a} workplaceOptions={data.allWorkplaces} isSelf={a.id === currentUserId} isOwner={isOwner} />
          ))}
        </div>
      </div>
    </div>
  );
}

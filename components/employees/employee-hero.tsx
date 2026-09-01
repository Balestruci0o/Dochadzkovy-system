"use client";

import { KeyRound, Loader2, Mail, Phone, Pencil, UserCheck, UserPlus, UserX } from "lucide-react";
import { useActionState, useState } from "react";
import {
  deactivateEmployeeAction,
  inviteEmployeeAction,
  reactivateEmployeeAction,
  resendInviteAction,
  updateEmployeeAction,
  type EmployeeFormState,
} from "@/app/(app)/zamestnanci/actions";
import {
  confirmDeleteEmployeeAction,
  requestDeleteEmployeeCodeAction,
} from "@/app/(app)/zamestnanci/[id]/actions";
import type { EmployeeDeletionSummary } from "@/app/(app)/zamestnanci/[id]/data";
import { Avatar } from "@/components/avatar";
import { HelpTooltip } from "@/components/help/help-tooltip";
import { SubmitButton } from "@/components/ui/submit-button";
import { GLOSSARY } from "@/lib/help/glossary";
import { DeleteEmployeeButton } from "./delete-employee-button";
import { PositionPill } from "./position-pill";
import { SetEmployeePasswordButton } from "./set-employee-password-button";

type EmployeeAccount = {
  email: string | null;
  role: "owner" | "manager" | "employee" | "accountant";
  activatedAt: Date | null;
} | null;

const initialState: EmployeeFormState = {};
const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";
const labelClass = "flex flex-col gap-1 text-sm text-ink";

type EmployeeCore = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  personalNumber: string | null;
  hiredOn: string;
  contractHoursPerMonth: string | null;
  contractType: string | null;
  vacationDaysPerYear: string | null;
  notes: string | null;
  isActive: boolean;
  workTimeMode: "rovnomerny" | "nerovnomerny_turnus";
  balancingPeriodMonths: number;
  overrideBreakTrackingMode: "automaticky" | "pipa" | null;
  overrideDepartureMode: "pipa" | "nepipa" | null;
  overridePayMode: "hodinovy" | "fixny" | null;
  canPunchWeb: boolean;
  canBeShiftLeader: boolean;
};

export function EmployeeHero({
  employee,
  positionName,
  positionColor,
  canEdit,
  account,
  isOwner,
  deletionSummary,
}: {
  employee: EmployeeCore;
  positionName: string | null;
  positionColor: string | null;
  canEdit: boolean;
  account: EmployeeAccount;
  isOwner: boolean;
  deletionSummary: EmployeeDeletionSummary;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateEmployeeAction, initialState);
  const [workTimeMode, setWorkTimeMode] = useState(employee.workTimeMode);
  const [overrideBreakTrackingMode, setOverrideBreakTrackingMode] = useState(employee.overrideBreakTrackingMode ?? "");
  const [overrideDepartureMode, setOverrideDepartureMode] = useState(employee.overrideDepartureMode ?? "");
  const [overridePayMode, setOverridePayMode] = useState(employee.overridePayMode ?? "");
  const fullName = `${employee.firstName} ${employee.lastName}`;

  if (editing) {
    return (
      <div className="rounded-[14px] border border-line bg-paper p-6 shadow-sm">
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="employeeId" value={employee.id} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Meno
              <input name="firstName" required defaultValue={employee.firstName} className={inputClass} />
            </label>
            <label className={labelClass}>
              Priezvisko
              <input name="lastName" required defaultValue={employee.lastName} className={inputClass} />
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Telefón
              <input name="phone" type="tel" defaultValue={employee.phone ?? ""} className={inputClass} />
            </label>
            <label className={labelClass}>
              Email
              <input name="email" type="email" defaultValue={employee.email ?? ""} className={inputClass} />
            </label>
          </div>
          <label className={labelClass}>
            Osobné číslo
            <span className="text-xs font-normal text-ink-faint">Číslo zamestnanca v mzdovom systéme</span>
            <input name="personalNumber" defaultValue={employee.personalNumber ?? ""} className={inputClass} />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1">
                Úväzok (hodín/mesiac)
                <HelpTooltip term={GLOSSARY.uvazok.term} explanation={GLOSSARY.uvazok.explanation} />
              </span>
              <input
                name="contractHoursPerMonth"
                type="number"
                step="0.5"
                min="0"
                defaultValue={employee.contractHoursPerMonth ?? ""}
                className={inputClass}
              />
            </label>
            <label className={labelClass}>
              Typ úväzku
              <select name="contractType" defaultValue={employee.contractType ?? ""} className={inputClass}>
                <option value="">— nevybraté —</option>
                <option value="plny">Plný úväzok</option>
                <option value="skrateny">Skrátený úväzok</option>
                <option value="dohoda">Dohoda</option>
              </select>
            </label>
          </div>
          <label className={labelClass}>
            Nárok na dovolenku (dní/rok)
            <input
              name="vacationDaysPerYear"
              type="number"
              step="0.5"
              min="0"
              defaultValue={employee.vacationDaysPerYear ?? "20"}
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              <span className="inline-flex items-center gap-1">
                Pracovný čas (§ZP)
                <HelpTooltip term={GLOSSARY.turnus.term} explanation={GLOSSARY.turnus.explanation} />
              </span>
              <select
                name="workTimeMode"
                value={workTimeMode}
                onChange={(e) => setWorkTimeMode(e.target.value as "rovnomerny" | "nerovnomerny_turnus")}
                className={inputClass}
              >
                <option value="rovnomerny">Rovnomerný (40 h/týždeň pevne)</option>
                <option value="nerovnomerny_turnus">Turnusový (§87 — priemer za obdobie)</option>
              </select>
            </label>
            {workTimeMode === "nerovnomerny_turnus" && (
              <label className={labelClass}>
                Vyrovnávacie obdobie (mesiace)
                <input
                  name="balancingPeriodMonths"
                  type="number"
                  min={1}
                  max={12}
                  defaultValue={employee.balancingPeriodMonths}
                  className={inputClass}
                />
              </label>
            )}
          </div>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1">
              Prestávky — prepis pozície
              <HelpTooltip term={GLOSSARY.rezimPrestavky.term} explanation={GLOSSARY.rezimPrestavky.explanation} />
            </span>
            <select
              name="overrideBreakTrackingMode"
              value={overrideBreakTrackingMode}
              onChange={(e) => setOverrideBreakTrackingMode(e.target.value as "" | "automaticky" | "pipa")}
              className={inputClass}
            >
              <option value="">— zdedené z pozície —</option>
              <option value="automaticky">Automaticky zo šablóny</option>
              <option value="pipa">Pípa si prestávky</option>
            </select>
          </label>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1">
              Režim odchodu — prepis pozície
              <HelpTooltip term={GLOSSARY.rezimOdchodu.term} explanation={GLOSSARY.rezimOdchodu.explanation} />
            </span>
            <select
              name="overrideDepartureMode"
              value={overrideDepartureMode}
              onChange={(e) => setOverrideDepartureMode(e.target.value as "" | "pipa" | "nepipa")}
              className={inputClass}
            >
              <option value="">— zdedené z pozície —</option>
              <option value="pipa">Pípa odchod</option>
              <option value="nepipa">Nepípa (auto na konci smeny)</option>
            </select>
          </label>
          <label className={labelClass}>
            <span className="inline-flex items-center gap-1">
              Režim odmeňovania — prepis pozície
              <HelpTooltip term={GLOSSARY.rezimOdmenovania.term} explanation={GLOSSARY.rezimOdmenovania.explanation} />
            </span>
            <select
              name="overridePayMode"
              value={overridePayMode}
              onChange={(e) => setOverridePayMode(e.target.value as "" | "hodinovy" | "fixny")}
              className={inputClass}
            >
              <option value="">— zdedené z pozície —</option>
              <option value="hodinovy">Hodinová sadzba</option>
              <option value="fixny">Fixný plat</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="canPunchWeb"
              defaultChecked={employee.canPunchWeb}
              className="accent-orange"
            />
            Môže sa pípať cez web (tlačidlo) — pre home office
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="canBeShiftLeader"
              defaultChecked={employee.canBeShiftLeader}
              className="accent-orange"
            />
            Môže byť vedúci zmeny
            <HelpTooltip term={GLOSSARY.veduciSmeny.term} explanation={GLOSSARY.veduciSmeny.explanation} />
          </label>
          <label className={labelClass}>
            Poznámky
            <textarea name="notes" defaultValue={employee.notes ?? ""} className={inputClass} rows={2} />
          </label>

          {state.error && <p className="text-sm text-late">{state.error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
            >
              {pending ? "Ukladám…" : "Uložiť"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
            >
              Zrušiť
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    // `flex-col` — na úzkom displeji sa avatar+info a tlačidlá NEZMESTIA
    // vedľa seba na jeden riadok; predtým to bol jeden `flex-wrap` riadok s
    // 3 položkami (avatar, info, tlačidlá), takže `min-w-0 flex-1` info blok
    // sa scvrkol na pár desiatok pixelov a jeho odznaky/text sa vizuálne
    // prekrývali s tlačidlami vedľa. Teraz sú to dva samostatné riadky —
    // avatar+info hore, tlačidlá (vlastný `flex-wrap`, nie stĺpec) dole.
    <div className="flex flex-col gap-5 rounded-[14px] border border-line bg-gradient-to-r from-paper to-sage-tint p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={fullName} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-serif text-2xl font-bold text-ink">{fullName}</h2>
          {!employee.isActive && (
            <span className="rounded-full bg-cream-2 px-2.5 py-0.5 text-xs font-semibold text-ink-faint">
              Neaktívny
            </span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-4">
          <PositionPill name={positionName} color={positionColor} />
          {employee.workTimeMode === "nerovnomerny_turnus" ? (
            <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
              Turnus · priemer {employee.balancingPeriodMonths} mes.
            </span>
          ) : (
            <span className="text-[11px] uppercase tracking-wide text-ink-faint">Rovnomerný</span>
          )}
          {employee.overrideBreakTrackingMode && (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
              Prepis: {employee.overrideBreakTrackingMode === "pipa" ? "Pípa prestávky" : "Automaticky zo šablóny"}
            </span>
          )}
          {employee.overrideDepartureMode && (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
              Prepis: {employee.overrideDepartureMode === "nepipa" ? "Nepípa odchod (auto)" : "Pípa odchod"}
            </span>
          )}
          {employee.overridePayMode && (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
              Prepis: {employee.overridePayMode === "fixny" ? "Fixný plat" : "Hodinová sadzba"}
            </span>
          )}
          {employee.canPunchWeb && (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sage-dark">
              Web-pípanie povolené
            </span>
          )}
          {employee.canBeShiftLeader && (
            <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
              Môže byť vedúci zmeny
            </span>
          )}
          {employee.phone && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <Phone size={14} /> {employee.phone}
            </span>
          )}
          {employee.email && (
            <span className="flex items-center gap-1.5 text-[13px] text-ink-soft">
              <Mail size={14} /> {employee.email}
            </span>
          )}
          {account ? (
            account.activatedAt ? (
              <span className="rounded-full bg-ok-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ok">
                Aktívne konto
              </span>
            ) : (
              <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                Pozvaný, čaká na aktiváciu
              </span>
            )
          ) : (
            <span className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              Nemá prihlasovacie konto
            </span>
          )}
        </div>
        <div className="mt-2 text-xs text-ink-soft">
          V družstve od {new Date(employee.hiredOn).toLocaleDateString("sk-SK")}
        </div>
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 rounded-md border border-line bg-paper px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-cream-2"
          >
            <Pencil size={15} /> Upraviť
          </button>
          {employee.isActive ? (
            <form action={deactivateEmployeeAction}>
              <input type="hidden" name="employeeId" value={employee.id} />
              <SubmitButton
                className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-late transition hover:bg-late-tint disabled:opacity-60"
                pendingContent={<Loader2 size={15} className="animate-spin" />}
              >
                <UserX size={15} /> Deaktivovať
              </SubmitButton>
            </form>
          ) : (
            <form action={reactivateEmployeeAction}>
              <input type="hidden" name="employeeId" value={employee.id} />
              <SubmitButton
                className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ok transition hover:bg-ok-tint disabled:opacity-60"
                pendingContent={<Loader2 size={15} className="animate-spin" />}
              >
                <UserCheck size={15} /> Aktivovať
              </SubmitButton>
            </form>
          )}
          {!account && employee.email && (
            <form action={inviteEmployeeAction}>
              <input type="hidden" name="employeeId" value={employee.id} />
              <SubmitButton
                className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-cream-2 disabled:opacity-60"
                pendingContent={
                  <>
                    <Loader2 size={15} className="animate-spin" /> Pozývam…
                  </>
                }
              >
                <UserPlus size={15} /> Pozvať do systému
              </SubmitButton>
            </form>
          )}
          {!account && employee.email && <SetEmployeePasswordButton employeeId={employee.id} />}
          {account && !account.activatedAt && (
            <form action={resendInviteAction}>
              <input type="hidden" name="employeeId" value={employee.id} />
              <SubmitButton
                className="flex items-center gap-1.5 rounded-md border border-line px-3.5 py-2 text-sm font-semibold text-ink transition hover:bg-cream-2 disabled:opacity-60"
                pendingContent={
                  <>
                    <Loader2 size={15} className="animate-spin" /> Posielam…
                  </>
                }
              >
                <KeyRound size={15} /> Poslať pozvánku znova
              </SubmitButton>
            </form>
          )}
          {!account && !employee.email && (
            <p className="text-center text-[11px] leading-snug text-ink-faint">Na pozvanie treba najprv doplniť email (Upraviť).</p>
          )}
        </div>
      )}
      {isOwner && (
        <div className="border-t border-line/60 pt-4">
          <DeleteEmployeeButton
            employeeId={employee.id}
            employeeName={fullName}
            summary={deletionSummary}
            hasAccount={account !== null}
            requestAction={requestDeleteEmployeeCodeAction}
            confirmAction={confirmDeleteEmployeeAction}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { AlertTriangle, ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Fragment, useActionState, useState } from "react";
import {
  deletePunchEventAction,
  directCorrectPunchAction,
  editPunchEventAction,
  type DirectCorrectionState,
} from "@/app/(app)/pipnutia/actions";
import type { PunchEventRow, PunchOverviewRow } from "@/app/(app)/pipnutia/data";
import { ATTENDANCE_STATUS_LABELS, fmtHours, fmtTime } from "./attendance-status";

function fmtBreak(min: number): string {
  return min > 0 ? `${min} min` : "—";
}

/** "HH:MM" v Europe/Bratislava, pre defaultValue <input type="time"> — `toLocaleTimeString` je locale-závislé, toto nie. */
function toTimeInputValue(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bratislava",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(d));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

const DIRECTION_LABEL: Record<string, string> = { in: "príchod", out: "odchod" };
const KIND_LABEL: Record<string, string> = { zmena: "smena", prestavka: "prestávka" };
const METHOD_LABEL: Record<string, string> = {
  qr_terminal: "QR terminál",
  web: "web",
  manual: "manuálne",
  auto_close: "automaticky",
};

const editInitialState: DirectCorrectionState = {};

/** Granulárna oprava JEDNÉHO pípnutia — čas, smer aj typ (prestávka ↔ smena) naraz. */
function EditEventForm({
  event,
  attendanceDayId,
  onDone,
}: {
  event: PunchEventRow;
  attendanceDayId: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(editPunchEventAction, editInitialState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5 rounded-md border border-line bg-paper p-3">
      <input type="hidden" name="attendanceDayId" value={attendanceDayId} />
      <input type="hidden" name="eventId" value={event.id} />
      <div className="grid grid-cols-3 gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-ink">
          Čas
          <input
            type="time"
            name="newTime"
            required
            defaultValue={toTimeInputValue(event.occurredAt)}
            className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-orange"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink">
          Typ
          <select
            name="newKind"
            defaultValue={event.kind}
            className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-orange"
          >
            <option value="zmena">Smena (príchod/odchod)</option>
            <option value="prestavka">Prestávka</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink">
          Smer
          <select
            name="newDirection"
            defaultValue={event.direction}
            className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-orange"
          >
            <option value="in">Príchod</option>
            <option value="out">Odchod</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-ink">
        Dôvod opravy
        <input
          name="reason"
          required
          placeholder="Napr. zle nastavený čas na termináli."
          className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-orange"
        />
      </label>
      {state.error && <p className="text-xs text-late">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-orange px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
        >
          {pending ? "Ukladám…" : "Uložiť"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-cream-2"
        >
          Zrušiť
        </button>
      </div>
    </form>
  );
}

const deleteInitialState: DirectCorrectionState = {};

function DeleteEventForm({ eventId, attendanceDayId, onDone }: { eventId: number; attendanceDayId: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(deletePunchEventAction, deleteInitialState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5 rounded-md border border-late/40 bg-late-tint p-3">
      <input type="hidden" name="attendanceDayId" value={attendanceDayId} />
      <input type="hidden" name="eventId" value={eventId} />
      <label className="flex flex-col gap-1 text-xs text-ink">
        Dôvod zmazania
        <input
          name="reason"
          required
          placeholder="Napr. omylom vytvorené duplicitné pípnutie."
          className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-ink outline-none focus:border-orange"
        />
      </label>
      {state.error && <p className="text-xs text-late">{state.error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-late px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Mažem…" : "Naozaj zmazať"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:bg-cream-2"
        >
          Zrušiť
        </button>
      </div>
    </form>
  );
}

function EventList({ events, attendanceDayId }: { events: PunchEventRow[]; attendanceDayId: string }) {
  const [action, setAction] = useState<{ id: number; mode: "edit" | "delete" } | null>(null);

  if (events.length === 0) {
    return <p className="py-2 text-sm text-ink-faint">Žiadne razítka tento deň.</p>;
  }
  return (
    <ul className="flex flex-col gap-1 py-2">
      {events.map((e) => {
        const canEdit = !e.superseded && !e.isVoid;
        const editingThis = action?.id === e.id && action.mode === "edit";
        const deletingThis = action?.id === e.id && action.mode === "delete";
        return (
          <li key={e.id} className="flex flex-col gap-1">
            <div
              className={`flex flex-wrap items-center gap-2 text-[13px] ${e.superseded || e.isVoid ? "text-ink-faint line-through decoration-line" : "text-ink"}`}
            >
              <span className="tabular-nums font-semibold">{fmtTime(e.occurredAt)}</span>
              <span>
                {KIND_LABEL[e.kind]} — {DIRECTION_LABEL[e.direction]}
              </span>
              <span className="text-ink-faint">({METHOD_LABEL[e.method] ?? e.method})</span>
              {e.isVoid && <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-semibold text-late">zmazané</span>}
              {!e.isVoid && e.correctsEventId != null && (
                <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-dark">opravná udalosť</span>
              )}
              {e.superseded && !e.isVoid && <span className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-semibold">nahradené opravou</span>}
              {e.correctionReason && (
                <span className="text-ink-faint" title={e.correctionReason}>
                  — {e.correctionReason}
                </span>
              )}
              {canEdit && (
                <span className="ml-auto flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAction(editingThis ? null : { id: e.id, mode: "edit" })}
                    className="flex items-center gap-1 text-xs font-semibold text-orange hover:text-orange-dark"
                  >
                    <Pencil size={12} /> Upraviť
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction(deletingThis ? null : { id: e.id, mode: "delete" })}
                    className="flex items-center gap-1 text-xs font-semibold text-late hover:opacity-80"
                  >
                    <Trash2 size={12} /> Zmazať
                  </button>
                </span>
              )}
            </div>
            {editingThis && <EditEventForm event={e} attendanceDayId={attendanceDayId} onDone={() => setAction(null)} />}
            {deletingThis && <DeleteEventForm eventId={e.id} attendanceDayId={attendanceDayId} onDone={() => setAction(null)} />}
          </li>
        );
      })}
    </ul>
  );
}

const initialState: DirectCorrectionState = {};

function CorrectionForm({ row, onDone }: { row: PunchOverviewRow; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(directCorrectPunchAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-line bg-cream p-3.5">
      <input type="hidden" name="attendanceDayId" value={row.id} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm text-ink">
          Príchod
          <input type="time" name="requestedStart" defaultValue={toTimeInputValue(row.actualStart)} className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange" />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink">
          Odchod
          <input type="time" name="requestedEnd" defaultValue={toTimeInputValue(row.actualEnd)} className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange" />
        </label>
        {row.canCorrectBreak && (
          <>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Prestávka od
              <input type="time" name="requestedBreakStart" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">
              Prestávka do
              <input type="time" name="requestedBreakEnd" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange" />
            </label>
          </>
        )}
      </div>
      <label className="flex flex-col gap-1 text-sm text-ink">
        Dôvod opravy
        <input
          name="reason"
          required
          placeholder="Napr. zabudol/a pípnuť, oprava podľa dochádzkovej knihy."
          className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange"
        />
      </label>

      {state.error && <p className="text-sm text-late">{state.error}</p>}
      {state.success && <p className="text-sm text-sage-dark">Uložené.</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-orange px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-dark disabled:opacity-60"
        >
          {pending ? "Ukladám…" : "Uložiť opravu"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
        >
          Zrušiť
        </button>
      </div>
    </form>
  );
}

export function PunchOverviewTable({
  rows,
  eventsByRow,
}: {
  rows: PunchOverviewRow[];
  eventsByRow: Record<string, PunchEventRow[]>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper shadow-sm">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <th className="px-3 py-3"></th>
            <th className="px-4 py-3">Zamestnanec</th>
            <th className="px-3 py-3">Dátum</th>
            <th className="px-3 py-3">Príchod</th>
            <th className="px-3 py-3">Odchod</th>
            <th className="px-3 py-3">Prestávka</th>
            <th className="px-3 py-3 text-right">Odpracované</th>
            <th className="px-3 py-3">Stav</th>
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = ATTENDANCE_STATUS_LABELS[r.status] ?? { label: r.status, color: "#9C988E" };
            const key = `${r.employeeId}|${r.date}`;
            const expanded = expandedId === r.id;
            const editing = editingId === r.id;
            return (
              <Fragment key={r.id}>
                <tr className="border-b border-line-soft last:border-0">
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      aria-label={expanded ? "Zbaliť" : "Zobraziť razítka"}
                      className="text-ink-faint hover:text-ink"
                    >
                      {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink">{r.employeeName}</td>
                  <td className="px-3 py-3 text-ink-soft">{new Date(`${r.date}T00:00:00`).toLocaleDateString("sk-SK")}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{fmtTime(r.actualStart)}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">{fmtTime(r.actualEnd)}</td>
                  <td className="px-3 py-3 tabular-nums text-ink-soft">
                    {r.onBreakSince ? (
                      <span className="text-orange">prebieha od {fmtTime(r.onBreakSince)}</span>
                    ) : (
                      fmtBreak(r.breakMinutes)
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{fmtHours(r.workedHours)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                        style={{ background: `${status.color}22`, color: status.color }}
                      >
                        {status.label}
                      </span>
                      {r.isLate && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-late" title={`Meškanie ${r.lateMinutes} min`}>
                          <AlertTriangle size={12} /> {r.lateMinutes} min
                        </span>
                      )}
                      {r.isCorrected && (
                        <span className="flex items-center gap-1 text-[11px] text-ink-faint" title="Opravené razítko">
                          <Pencil size={11} /> opravené
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(editing ? null : r.id);
                        setExpandedId(r.id);
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-orange hover:text-orange-dark"
                    >
                      <Pencil size={13} /> Upraviť deň
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-line-soft bg-cream/40 last:border-0">
                    <td />
                    <td colSpan={8} className="px-4 py-2">
                      <EventList events={eventsByRow[key] ?? []} attendanceDayId={r.id} />
                      {editing && <CorrectionForm row={r} onDone={() => setEditingId(null)} />}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="py-8 text-center text-sm text-ink-faint">Za toto obdobie a filter nie sú žiadne záznamy.</p>}
    </div>
  );
}

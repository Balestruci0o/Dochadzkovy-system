"use client";

import { Loader2, Plus } from "lucide-react";
import { useState } from "react";
import {
  confirmDeleteWorkplaceAction,
  requestDeleteWorkplaceCodeAction,
  toggleWorkplaceActiveAction,
} from "@/app/(app)/nastavenia/prevadzky/actions";
import { DeleteWithCodeButton } from "@/components/settings/delete-with-code-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { WEEKDAYS } from "@/lib/shared/weekdays";
import { WorkplaceForm, type ExistingWorkplace } from "./workplace-form";

function describeDays(days: number[]): string {
  if (days.length === 7) return "každý deň";
  return WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => d.short)
    .join(", ");
}

export function WorkplaceList({ workplaces }: { workplaces: ExistingWorkplace[] }) {
  const [formMode, setFormMode] = useState<"none" | "add" | string>("none");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Prevádzky</h3>
        {formMode === "none" && (
          <button
            type="button"
            onClick={() => setFormMode("add")}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Nová prevádzka
          </button>
        )}
      </div>

      {formMode === "add" && <WorkplaceForm onDone={() => setFormMode("none")} />}

      <div className="flex flex-col gap-2.5">
        {workplaces.map((w) => {
          if (formMode === w.id) {
            return <WorkplaceForm key={w.id} existing={w} onDone={() => setFormMode("none")} />;
          }
          const active = w.isActive;
          return (
            <div
              key={w.id}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-md border border-line p-3.5 ${!active ? "opacity-50" : ""}`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <b className="text-sm font-semibold text-ink">{w.name}</b>
                  <span className="rounded bg-cream-2 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-ink-faint">
                    {w.code}
                  </span>
                  {!active && (
                    <span className="rounded-full bg-cream-2 px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                      Neaktívna
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-faint">
                  {describeDays(w.operatingDays)}
                  {w.operatesHolidays ? "" : " · zatvorené počas sviatkov"}
                  {w.gpsLat && w.gpsLng ? ` · GPS ${w.gpsLat}, ${w.gpsLng} (±${w.gpsRadiusM ?? 150} m)` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFormMode(w.id)}
                  className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
                >
                  Upraviť
                </button>
                <form action={toggleWorkplaceActiveAction}>
                  <input type="hidden" name="id" value={w.id} />
                  <input type="hidden" name="nextActive" value={active ? "false" : "true"} />
                  <SubmitButton
                    className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                    pendingContent={<Loader2 size={14} className="animate-spin" />}
                  >
                    {active ? "Deaktivovať" : "Aktivovať"}
                  </SubmitButton>
                </form>
                <DeleteWithCodeButton
                  id={w.id}
                  label={w.name}
                  requestAction={requestDeleteWorkplaceCodeAction}
                  confirmAction={confirmDeleteWorkplaceAction}
                />
              </div>
            </div>
          );
        })}
        {workplaces.length === 0 && formMode !== "add" && (
          <p className="py-4 text-center text-sm text-ink-faint">Zatiaľ žiadna prevádzka.</p>
        )}
      </div>
    </div>
  );
}

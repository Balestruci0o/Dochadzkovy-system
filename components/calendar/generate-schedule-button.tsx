"use client";

import { AlertTriangle, CheckCircle2, Sparkles, X } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { generateScheduleAction, type GenerateActionState } from "@/app/(app)/kalendar/generate-actions";
import { monthLabel } from "@/lib/shared/dates";

const initialState: GenerateActionState = {};

/**
 * Blok 9d-5 (🔍) — "Generovať/Pregenerovať rozvrh". `generatedCount`/
 * `lockedCount` prichádzajú z `data.cells` (rodič ich už má, žiadny extra
 * dotaz) — rozlišujú "prázdny mesiac" (Generovať) od "už niečo existuje"
 * (Pregenerovať, s upozornením PRESNE koľko vygenerovaných zmien sa
 * prepíše a koľko zamknutých ostane netknutých).
 */
export function GenerateScheduleButton({
  workplaceId,
  workplaceName,
  year,
  month,
  generatedCount,
  lockedCount,
}: {
  workplaceId: string;
  workplaceName: string;
  year: number;
  month: number;
  generatedCount: number;
  lockedCount: number;
}) {
  const [state, formAction, pending] = useActionState(generateScheduleAction, initialState);
  const [confirming, setConfirming] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const isRegenerate = generatedCount > 0;

  // Otvor report LEN keď akcia naozaj doručí NOVÝ výsledok (nie pri
  // každom re-rendri) — `state` mení identitu iba po dispatchi, takže
  // manuálne zavretie (`setReportOpen(false)`) zostane zavreté, kým
  // nepríde ĎALŠÍ beh.
  useEffect(() => {
    if (state === initialState) return;
    setReportOpen(true);
    setConfirming(false);
  }, [state]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
      >
        <Sparkles size={15} />
        {isRegenerate ? "Pregenerovať rozvrh" : "Generovať rozvrh"}
      </button>

      {confirming && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] rounded-[12px] border border-line bg-paper p-4 shadow-lg">
          <div className="mb-2 flex items-start justify-between gap-2">
            <b className="text-sm text-ink">
              {isRegenerate ? "Pregenerovať" : "Generovať"} rozvrh — {monthLabel(year, month)}
            </b>
            <button type="button" onClick={() => setConfirming(false)} className="rounded p-0.5 text-ink-faint hover:bg-cream-2">
              <X size={14} />
            </button>
          </div>

          {isRegenerate ? (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-[#E9C9AE] bg-late-tint px-3 py-2.5 text-[12.5px] text-late">
              <AlertTriangle size={15} className="mt-0.5 flex-none" />
              <span>
                <b>{generatedCount}</b> automaticky vygenerovaných smien pre {workplaceName} sa <b>prepíše</b> novým výpočtom.{" "}
                {lockedCount > 0 ? (
                  <>
                    <b>{lockedCount}</b> ručne zamknutých smien ostane úplne nedotknutých.
                  </>
                ) : (
                  "Žiadne ručne zamknuté smeny tento mesiac zatiaľ nie sú."
                )}
              </span>
            </div>
          ) : (
            <p className="mb-3 text-[12.5px] text-ink-soft">
              Vygeneruje rozvrh pre <b>{workplaceName}</b> podľa nastaveného pokrytia a pravidiel dostupnosti.
              {lockedCount > 0 && (
                <>
                  {" "}
                  <b>{lockedCount}</b> ručne zamknutých smien ostane nedotknutých.
                </>
              )}
            </p>
          )}

          <form
            action={formAction}
            onSubmit={() => setConfirming(false)}
            className="flex justify-end gap-2"
          >
            <input type="hidden" name="workplaceId" value={workplaceId} />
            <input type="hidden" name="year" value={year} />
            <input type="hidden" name="month" value={month} />
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-cream-2"
            >
              Zrušiť
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white transition disabled:opacity-60 ${
                isRegenerate ? "bg-late hover:bg-[#A8432B]" : "bg-sage hover:bg-sage-dark"
              }`}
            >
              {pending ? "Generujem…" : isRegenerate ? "Pregenerovať" : "Generovať"}
            </button>
          </form>
        </div>
      )}

      {reportOpen && (state.report || state.error) && (
        <GenerateReportPanel state={state} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}

function GenerateReportPanel({ state, onClose }: { state: GenerateActionState; onClose: () => void }) {
  const r = state.report;
  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-[420px] rounded-[12px] border border-line bg-paper p-4 shadow-lg">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {state.error ? (
            <AlertTriangle size={16} className="text-late" />
          ) : (
            <CheckCircle2 size={16} className="text-sage-dark" />
          )}
          <b className="text-sm text-ink">{state.error ? "Generovanie zlyhalo" : "Rozvrh vygenerovaný"}</b>
        </div>
        <button type="button" onClick={onClose} className="rounded p-0.5 text-ink-faint hover:bg-cream-2">
          <X size={14} />
        </button>
      </div>

      {state.error && <p className="text-[13px] text-late">{state.error}</p>}

      {r && (
        <>
          <div className="mb-3 flex flex-wrap gap-4 text-[13px] text-ink">
            <span>
              <b className="text-base">{r.shiftsCreated}</b> smien vytvorených
            </span>
            {r.shiftsSkippedLocked > 0 && (
              <span className="text-ink-soft">
                <b className="text-base text-ink">{r.shiftsSkippedLocked}</b> zamknutých preskočených
              </span>
            )}
            <span className={r.gaps.length > 0 ? "text-late" : "text-sage-dark"}>
              <b className="text-base">{r.gaps.length}</b> {r.gaps.length === 1 ? "diera" : "diery/dier"}
            </span>
          </div>

          {r.gaps.length > 0 ? (
            <div className="max-h-64 overflow-y-auto rounded-md border border-line-soft">
              {r.gaps.map((g, i) => (
                <div
                  key={`${g.date}-${i}`}
                  className={`px-3 py-2 text-[12.5px] leading-snug text-ink-soft ${i > 0 ? "border-t border-line-soft" : ""}`}
                >
                  {g.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-[#C6DBC4] bg-ok-tint px-3 py-2 text-[12.5px] text-sage-dark">
              Pokrytie kompletné — každý deň má obsadené minimum podľa pravidiel.
            </p>
          )}
        </>
      )}
    </div>
  );
}

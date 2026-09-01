import { cancelAbsenceRequestAction } from "@/app/(app)/moje-ziadosti/actions";
import type { MyAbsenceRequest } from "@/app/(app)/moje-ziadosti/data";
import { ABSENCE_KIND_CONFIG } from "@/components/calendar/absence-kinds";
import { SubmitButton } from "@/components/ui/submit-button";

const STATUS_LABEL: Record<MyAbsenceRequest["status"], { label: string; className: string }> = {
  pending: { label: "Čaká na schválenie", className: "bg-gold-tint text-[#A8761A]" },
  approved: { label: "Schválené", className: "bg-sage-tint text-sage-dark" },
  rejected: { label: "Zamietnuté", className: "bg-late-tint text-late" },
  cancelled: { label: "Zrušené", className: "bg-cream-2 text-ink-faint" },
};

function fmtDate(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString("sk-SK");
}

export function MyAbsenceRequestList({ requests }: { requests: MyAbsenceRequest[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-ink-faint">Zatiaľ žiadne žiadosti.</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {requests.map((r) => {
        const kindCfg = ABSENCE_KIND_CONFIG[r.kind];
        const statusCfg = STATUS_LABEL[r.status];
        return (
          <div key={r.id} className="rounded-md border border-line p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ background: `${kindCfg.color}22`, color: kindCfg.color }}>
                    {kindCfg.label}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${statusCfg.className}`}>{statusCfg.label}</span>
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {fmtDate(r.dateFrom)}
                  {r.dateTo !== r.dateFrom && <> – {fmtDate(r.dateTo)}</>}
                  {r.isPartialDay && r.hours != null && <> · {r.hours} h</>}
                </p>
                {r.reason && <p className="mt-1 text-xs text-ink-faint">„{r.reason}“</p>}
                {r.status === "rejected" && r.decisionNote && <p className="mt-1 text-xs text-late">Dôvod zamietnutia: {r.decisionNote}</p>}
              </div>
              {r.status === "pending" && (
                <form action={cancelAbsenceRequestAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <SubmitButton className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft transition hover:bg-late-tint hover:text-late disabled:opacity-60">
                    Zrušiť
                  </SubmitButton>
                </form>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

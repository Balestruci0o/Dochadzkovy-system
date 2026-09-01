"use client";

import { Loader2, X } from "lucide-react";
import { useState } from "react";
import { assignWorkplaceAction, unassignWorkplaceAction } from "@/app/(app)/zamestnanci/[id]/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export function WorkplacesSection({
  employeeId,
  assigned,
  allWorkplaces,
  canEdit,
}: {
  employeeId: string;
  assigned: { workplaceId: string; workplaceName: string }[];
  allWorkplaces: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const assignedIds = new Set(assigned.map((a) => a.workplaceId));
  const available = allWorkplaces.filter((w) => !assignedIds.has(w.id));

  return (
    <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <h3 className="mb-3 font-serif text-base font-bold text-ink">Prevádzky</h3>
      <p className="mb-3 text-xs text-ink-faint">Zamestnanec môže byť priradený vo viacerých prevádzkach naraz.</p>

      <div className="flex flex-wrap gap-2">
        {assigned.map((a) => (
          <span
            key={a.workplaceId}
            className="flex items-center gap-1.5 rounded-full bg-sage-tint px-3 py-1.5 text-sm font-medium text-sage-dark"
          >
            {a.workplaceName}
            {canEdit && assigned.length > 1 && (
              <form action={unassignWorkplaceAction}>
                <input type="hidden" name="employeeId" value={employeeId} />
                <input type="hidden" name="workplaceId" value={a.workplaceId} />
                <SubmitButton
                  className="text-sage-dark/70 hover:text-late disabled:opacity-60"
                  aria-label={`Odobrať ${a.workplaceName}`}
                  pendingContent={<Loader2 size={13} className="animate-spin" />}
                >
                  <X size={13} />
                </SubmitButton>
              </form>
            )}
          </span>
        ))}
      </div>

      {canEdit && available.length > 0 && (
        <div className="mt-3">
          {adding ? (
            <form
              action={assignWorkplaceAction}
              className="flex items-center gap-2"
              onSubmit={() => setAdding(false)}
            >
              <input type="hidden" name="employeeId" value={employeeId} />
              <select
                name="workplaceId"
                required
                defaultValue=""
                className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm"
              >
                <option value="" disabled>
                  — vyber prevádzku —
                </option>
                {available.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <SubmitButton
                className="text-sm font-semibold text-orange hover:text-orange-dark disabled:opacity-60"
                pendingContent={
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" /> Pridávam…
                  </span>
                }
              >
                Pridať
              </SubmitButton>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-sm font-semibold text-orange hover:text-orange-dark"
            >
              + Priradiť ďalšiu prevádzku
            </button>
          )}
        </div>
      )}
    </div>
  );
}

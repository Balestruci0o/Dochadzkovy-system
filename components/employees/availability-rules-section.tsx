"use client";

import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { deleteAvailabilityRuleAction, toggleAvailabilityRuleActiveAction } from "@/app/(app)/zamestnanci/[id]/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { RULE_TYPE_CONFIG, describeRuleParams } from "./availability-rule-types";
import { RuleForm, type ExistingRule } from "./rule-form";

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleDateString("sk-SK") : null;
}

export function AvailabilityRulesSection({
  employeeId,
  rules,
  workplaceOptions,
  shiftTemplateOptions,
  canEdit,
}: {
  employeeId: string;
  rules: ExistingRule[];
  workplaceOptions: { id: string; name: string }[];
  shiftTemplateOptions: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [formMode, setFormMode] = useState<"none" | "add" | string>("none");

  return (
    <div className="rounded-[14px] border-2 border-sage bg-paper p-5 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-serif text-lg font-bold text-ink">Pravidlá dostupnosti</h3>
        {canEdit && formMode === "none" && (
          <button
            type="button"
            onClick={() => setFormMode("add")}
            className="flex items-center gap-1.5 rounded-md bg-sage px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-sage-dark"
          >
            <Plus size={16} /> Pridať pravidlo
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-faint">
        „Andrej môže len 5-dňové bloky&rdquo;, „Jana môže každý deň&rdquo;, „Eva len ranné okrem nedele&rdquo; — všetko sú
        riadky tu, nie výnimky v kóde.
      </p>

      {formMode === "add" && (
        <div className="mb-4">
          <RuleForm
            employeeId={employeeId}
            workplaceOptions={workplaceOptions}
            shiftTemplateOptions={shiftTemplateOptions}
            onDone={() => setFormMode("none")}
          />
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {rules.map((rule) => {
          const isEditing = formMode === rule.id;
          if (isEditing) {
            return (
              <RuleForm
                key={rule.id}
                employeeId={employeeId}
                workplaceOptions={workplaceOptions}
                shiftTemplateOptions={shiftTemplateOptions}
                existing={rule}
                onDone={() => setFormMode("none")}
              />
            );
          }

          const cfg = RULE_TYPE_CONFIG[rule.ruleType];
          const from = fmt(rule.validFrom);
          const to = fmt(rule.validTo);
          const workplaceName = workplaceOptions.find((w) => w.id === rule.workplaceId)?.name;

          return (
            <div
              key={rule.id}
              className={`rounded-md border border-line p-3.5 ${rule.isActive === false ? "opacity-50" : ""}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-sm font-semibold text-ink">{cfg.label}</b>
                    {rule.isHard ? (
                      <span className="rounded-full bg-late-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-late">
                        Hard
                      </span>
                    ) : (
                      <span className="rounded-full bg-gold-tint px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#A8761A]">
                        Soft · priorita {rule.priority}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">{describeRuleParams(rule.ruleType, rule.params)}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint">
                    {workplaceName && <span>Len {workplaceName}</span>}
                    {(from || to) && (
                      <span>
                        Platné {from ?? "vždy"} – {to ?? "vždy"}
                      </span>
                    )}
                    {rule.note && <span>„{rule.note}&rdquo;</span>}
                  </div>
                </div>

                {canEdit && (
                  <div className="flex flex-none items-center gap-1">
                    <form action={toggleAvailabilityRuleActiveAction}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <input type="hidden" name="employeeId" value={employeeId} />
                      <input type="hidden" name="nextActive" value={rule.isActive === false ? "true" : "false"} />
                      <SubmitButton
                        className="rounded px-2 py-1 text-xs font-semibold text-ink-soft transition hover:bg-cream-2 disabled:opacity-60"
                        pendingContent={<Loader2 size={13} className="animate-spin" />}
                      >
                        {rule.isActive === false ? "Aktivovať" : "Deaktivovať"}
                      </SubmitButton>
                    </form>
                    <button
                      type="button"
                      onClick={() => setFormMode(rule.id)}
                      className="rounded p-1.5 text-ink-soft hover:bg-cream-2"
                      aria-label="Upraviť pravidlo"
                    >
                      <Pencil size={15} />
                    </button>
                    <form action={deleteAvailabilityRuleAction}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <input type="hidden" name="employeeId" value={employeeId} />
                      <SubmitButton
                        className="rounded p-1.5 text-ink-soft transition hover:bg-late-tint hover:text-late disabled:opacity-60"
                        aria-label="Vymazať pravidlo"
                        pendingContent={<Loader2 size={15} className="animate-spin" />}
                      >
                        <Trash2 size={15} />
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {rules.length === 0 && formMode !== "add" && (
          <p className="py-4 text-center text-sm text-ink-faint">
            Zatiaľ žiadne pravidlá — zamestnanec je dostupný bez obmedzení.
          </p>
        )}
      </div>
    </div>
  );
}

"use client";

import { WEEKDAYS, type AvailabilityRuleType, type RuleParamShape } from "./availability-rule-types";

const inputClass =
  "rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-orange";

/**
 * Vstupy sa menia podľa vybraného typu pravidla — presne to je jadro tejto
 * obrazovky: výber typu pravidla, parametre podľa typu.
 */
export function RuleParamInputs({
  shape,
  params,
  shiftTemplateOptions,
}: {
  shape: RuleParamShape;
  params?: Record<string, unknown>;
  shiftTemplateOptions: { id: string; name: string }[];
}) {
  switch (shape) {
    case "weekdays": {
      const defaultDays = (params?.days as number[] | undefined) ?? [];
      return (
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <label
              key={d.value}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm has-[:checked]:border-orange has-[:checked]:bg-orange-tint"
            >
              <input
                type="checkbox"
                name="days"
                value={d.value}
                defaultChecked={defaultDays.includes(d.value)}
                className="accent-orange"
              />
              {d.short}
            </label>
          ))}
        </div>
      );
    }

    case "days":
      return (
        <label className="flex flex-col gap-1 text-sm text-ink">
          Počet dní
          <input
            type="number"
            name="daysValue"
            min={1}
            required
            defaultValue={(params?.days as number | undefined) ?? ""}
            className={`${inputClass} w-28`}
          />
        </label>
      );

    case "parity": {
      const defaultParity = (params?.parity as string | undefined) ?? "even";
      return (
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm text-ink">
            <input type="radio" name="parity" value="even" defaultChecked={defaultParity === "even"} />
            Párne týždne
          </label>
          <label className="flex items-center gap-1.5 text-sm text-ink">
            <input type="radio" name="parity" value="odd" defaultChecked={defaultParity === "odd"} />
            Nepárne týždne
          </label>
        </div>
      );
    }

    case "dateRange":
      return (
        <div className="flex gap-3">
          <label className="flex flex-col gap-1 text-sm text-ink">
            Od
            <input
              type="date"
              name="from"
              required
              defaultValue={(params?.from as string | undefined) ?? ""}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-ink">
            Do
            <input
              type="date"
              name="to"
              required
              defaultValue={(params?.to as string | undefined) ?? ""}
              className={inputClass}
            />
          </label>
        </div>
      );

    case "hours":
      return (
        <label className="flex flex-col gap-1 text-sm text-ink">
          Počet hodín
          <input
            type="number"
            name="hoursValue"
            min={0}
            step="0.5"
            required
            defaultValue={(params?.hours as number | undefined) ?? ""}
            className={`${inputClass} w-28`}
          />
        </label>
      );

    case "shiftTemplate":
      if (shiftTemplateOptions.length === 0) {
        return (
          <p className="text-sm text-ink-faint">
            Zatiaľ nie sú vytvorené žiadne šablóny smien — najprv ich pridaj v Nastaveniach.
          </p>
        );
      }
      return (
        <label className="flex flex-col gap-1 text-sm text-ink">
          Šablóna smeny
          <select
            name="shiftTemplateId"
            required
            defaultValue={(params?.shift_template_id as string | undefined) ?? ""}
            className={inputClass}
          >
            <option value="" disabled>
              — vyber —
            </option>
            {shiftTemplateOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      );
  }
}

export type { AvailabilityRuleType };

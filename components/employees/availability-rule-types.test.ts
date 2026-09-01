import { describe, expect, it } from "vitest";
import { describeRuleParams, RULE_TYPE_OPTIONS, validateRuleParams } from "./availability-rule-types";

describe("validateRuleParams", () => {
  it("allowed_weekdays / blocked_weekdays: vyžaduje aspoň jeden deň 1-7", () => {
    expect(validateRuleParams("allowed_weekdays", { days: [1, 3, 5] })).toEqual({ valid: true });
    expect(validateRuleParams("allowed_weekdays", { days: [] }).valid).toBe(false);
    expect(validateRuleParams("allowed_weekdays", { days: [0, 8] }).valid).toBe(false);
    expect(validateRuleParams("blocked_weekdays", {}).valid).toBe(false);
  });

  it("block_length / max_consecutive_days / min_rest_days: kladné celé číslo dní", () => {
    expect(validateRuleParams("block_length", { days: 5 })).toEqual({ valid: true });
    expect(validateRuleParams("max_consecutive_days", { days: 0 }).valid).toBe(false);
    expect(validateRuleParams("min_rest_days", { days: "5" }).valid).toBe(false);
  });

  it("week_parity: len 'even' alebo 'odd'", () => {
    expect(validateRuleParams("week_parity", { parity: "even" })).toEqual({ valid: true });
    expect(validateRuleParams("week_parity", { parity: "odd" })).toEqual({ valid: true });
    expect(validateRuleParams("week_parity", { parity: "monthly" }).valid).toBe(false);
  });

  it("date_range_available / date_range_blocked: from musí byť pred to", () => {
    expect(
      validateRuleParams("date_range_available", { from: "2026-08-01", to: "2026-08-14" }),
    ).toEqual({ valid: true });
    expect(
      validateRuleParams("date_range_blocked", { from: "2026-08-14", to: "2026-08-01" }).valid,
    ).toBe(false);
    expect(validateRuleParams("date_range_blocked", { from: "2026-08-01" }).valid).toBe(false);
  });

  it("max_hours_per_week / max_hours_per_month / min_hours_per_month: kladný počet hodín", () => {
    expect(validateRuleParams("min_hours_per_month", { hours: 160 })).toEqual({ valid: true });
    expect(validateRuleParams("max_hours_per_week", { hours: 0 }).valid).toBe(false);
    expect(validateRuleParams("max_hours_per_month", { hours: -5 }).valid).toBe(false);
  });

  it("preferred_shift: vyžaduje shift_template_id", () => {
    expect(validateRuleParams("preferred_shift", { shift_template_id: "abc-123" })).toEqual({
      valid: true,
    });
    expect(validateRuleParams("preferred_shift", {}).valid).toBe(false);
  });
});

describe("describeRuleParams", () => {
  it("vyskladá čitateľný slovenský popis pre každý typ", () => {
    expect(describeRuleParams("allowed_weekdays", { days: [1, 2, 3] })).toContain("Po, Ut, St");
    expect(describeRuleParams("block_length", { days: 5 })).toBe("5-dňové bloky");
    expect(describeRuleParams("week_parity", { parity: "even" })).toBe("Len párne týždne");
    expect(describeRuleParams("min_hours_per_month", { hours: 160 })).toBe("Min. 160 h / mesiac (nepoužívané)");
  });
});

/**
 * Q10 — `min_hours_per_month` bolo zamýšľané ako zdroj
 * zmluvného fondu, ale generátor ho nikdy nečítal (aktívny zdroj je
 * `employees.contract_hours_per_month`) — dve miesta na tú istú vec by len
 * mýlili, preto sa vynecháva z výberu pri zakladaní nového pravidla.
 */
describe("RULE_TYPE_OPTIONS", () => {
  it("min_hours_per_month sa NEPONÚKA pri zakladaní nového pravidla (nepoužívané, zdroj fondu je Úväzok na profile zamestnanca)", () => {
    expect(RULE_TYPE_OPTIONS.some((o) => o.value === "min_hours_per_month")).toBe(false);
  });

  it("ostatné typy pravidiel zostávajú ponúknuté", () => {
    expect(RULE_TYPE_OPTIONS.some((o) => o.value === "block_length")).toBe(true);
    expect(RULE_TYPE_OPTIONS.some((o) => o.value === "max_hours_per_month")).toBe(true);
  });
});

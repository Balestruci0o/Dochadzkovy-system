import { describe, expect, it } from "vitest";
import { resolveWorkTimeMode } from "./work-time-mode";

describe("resolveWorkTimeMode — VÝHRADNE na zamestnancovi, pozícia sa doň nepremieta", () => {
  it("vráti presne mode aj balancingPeriodMonths zo zamestnanca", () => {
    const resolved = resolveWorkTimeMode({ workTimeMode: "nerovnomerny_turnus", balancingPeriodMonths: 6 });
    expect(resolved).toEqual({ mode: "nerovnomerny_turnus", balancingPeriodMonths: 6 });
  });

  it("rovnomerný režim s vlastným vyrovnávacím obdobím (nezmyselné pri rovnomernom, ale funkcia ho neinterpretuje, len prenáša)", () => {
    const resolved = resolveWorkTimeMode({ workTimeMode: "rovnomerny", balancingPeriodMonths: 3 });
    expect(resolved).toEqual({ mode: "rovnomerny", balancingPeriodMonths: 3 });
  });
});

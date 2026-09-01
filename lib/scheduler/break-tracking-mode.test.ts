import { describe, expect, it } from "vitest";
import { resolveBreakTrackingMode } from "./break-tracking-mode";

describe("resolveBreakTrackingMode", () => {
  it("zamestnanec bez override zdedí režim z pozície", () => {
    expect(resolveBreakTrackingMode({ breakTrackingMode: "pipa" }, { overrideBreakTrackingMode: null })).toBe("pipa");
  });

  it("override zamestnanca prebije default pozície", () => {
    expect(resolveBreakTrackingMode({ breakTrackingMode: "automaticky" }, { overrideBreakTrackingMode: "pipa" })).toBe(
      "pipa",
    );
  });

  it("zamestnanec bez priradenej pozície (positionId=null) → bezpečný default automaticky (dnešné správanie)", () => {
    expect(resolveBreakTrackingMode(null, { overrideBreakTrackingMode: null })).toBe("automaticky");
  });
});

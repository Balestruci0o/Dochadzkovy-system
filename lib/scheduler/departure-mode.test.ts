import { describe, expect, it } from "vitest";
import { resolveDepartureMode } from "./departure-mode";

describe("resolveDepartureMode", () => {
  it("zamestnanec bez override zdedí režim z pozície", () => {
    expect(resolveDepartureMode({ departureMode: "nepipa" }, { overrideDepartureMode: null })).toBe("nepipa");
  });

  it("override zamestnanca prebije default pozície", () => {
    expect(resolveDepartureMode({ departureMode: "pipa" }, { overrideDepartureMode: "nepipa" })).toBe("nepipa");
  });

  it("zamestnanec bez priradenej pozície (positionId=null) → bezpečný default pipa (dnešné správanie)", () => {
    expect(resolveDepartureMode(null, { overrideDepartureMode: null })).toBe("pipa");
  });
});

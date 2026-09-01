import { describe, expect, it } from "vitest";
import { resolvePayMode } from "./resolve-pay-mode";

describe("resolvePayMode", () => {
  it("zamestnanec bez override zdedí režim z pozície", () => {
    expect(resolvePayMode({ payMode: "fixny" }, { overridePayMode: null })).toBe("fixny");
  });

  it("override zamestnanca prebije default pozície", () => {
    expect(resolvePayMode({ payMode: "hodinovy" }, { overridePayMode: "fixny" })).toBe("fixny");
  });

  it("zamestnanec bez priradenej pozície (positionId=null) → bezpečný default hodinovy (dnešné správanie)", () => {
    expect(resolvePayMode(null, { overridePayMode: null })).toBe("hodinovy");
  });
});

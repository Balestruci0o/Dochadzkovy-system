import { describe, expect, it } from "vitest";
import { resolveBreakOverride } from "./break-override";

describe("resolveBreakOverride", () => {
  it("prázdna hodnota (nič nezadané) → default zo šablóny", () => {
    expect(resolveBreakOverride(null, 30)).toBe(30);
    expect(resolveBreakOverride("", 30)).toBe(30);
  });

  it("manažér zadá vlastnú hodnotu → prebije šablónu", () => {
    expect(resolveBreakOverride("60", 30)).toBe(60);
  });

  it("manažér zadá 0 (žiadna prestávka) → rešpektuje sa, nepadne späť na default", () => {
    expect(resolveBreakOverride("0", 30)).toBe(0);
  });

  it("neplatná (záporná alebo nečíselná) hodnota → default zo šablóny, nič sa nerozbije", () => {
    expect(resolveBreakOverride("-5", 30)).toBe(30);
    expect(resolveBreakOverride("abc", 30)).toBe(30);
  });

  it("desatinné číslo sa zaokrúhli", () => {
    expect(resolveBreakOverride("45.6", 30)).toBe(46);
  });
});

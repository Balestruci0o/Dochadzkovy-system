import { describe, expect, it } from "vitest";
import { liveWorkedHours } from "./live-worked-hours";

const T = (hhmm: string) => new Date(`2026-08-05T${hhmm}:00Z`);

describe("liveWorkedHours — presné príklady zo zadania", () => {
  it("príchod 20:20, teraz 22:20, žiadna prestávka → 2 h", () => {
    expect(liveWorkedHours(T("20:20"), [], T("22:20"))).toBeCloseTo(2, 5);
  });

  it("príchod 20:20, teraz 22:20, prestávka 30 min (dokončená) → 1,5 h", () => {
    const breaks = [
      { direction: "out" as const, occurredAt: T("21:00") },
      { direction: "in" as const, occurredAt: T("21:30") },
    ];
    expect(liveWorkedHours(T("20:20"), breaks, T("22:20"))).toBeCloseTo(1.5, 5);
  });

  it("práve NA prestávke (odišiel, nevrátil sa) → čas beží len po odchod, počas prestávky nerastie", () => {
    const breaks = [{ direction: "out" as const, occurredAt: T("21:00") }];
    // "teraz" je zámerne až 22:20, ale keďže je na prestávke, počíta sa len do 21:00.
    const worked = liveWorkedHours(T("20:20"), breaks, T("22:20"));
    expect(worked).toBeCloseTo(40 / 60, 5); // 20:20 -> 21:00 = 40 min
  });

  it("po návrate z prestávky pokračuje ďalej (prestávka má teraz aj end)", () => {
    const breaks = [
      { direction: "out" as const, occurredAt: T("21:00") },
      { direction: "in" as const, occurredAt: T("21:15") },
    ];
    // 20:20 -> 22:20 = 2h, mínus 15 min prestávka = 1h45min
    expect(liveWorkedHours(T("20:20"), breaks, T("22:20"))).toBeCloseTo(1.75, 5);
  });

  it("viacero dokončených prestávok sa spočítajú spolu", () => {
    const breaks = [
      { direction: "out" as const, occurredAt: T("21:00") },
      { direction: "in" as const, occurredAt: T("21:15") },
      { direction: "out" as const, occurredAt: T("21:45") },
      { direction: "in" as const, occurredAt: T("22:00") },
    ];
    // 2h - 15min - 15min = 1,5h
    expect(liveWorkedHours(T("20:20"), breaks, T("22:20"))).toBeCloseTo(1.5, 5);
  });

  it("nikdy nevráti záporné číslo (obranné, keby 'teraz' bolo pred príchodom)", () => {
    expect(liveWorkedHours(T("22:20"), [], T("20:20"))).toBe(0);
  });
});

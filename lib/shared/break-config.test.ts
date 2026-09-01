import { describe, expect, it } from "vitest";
import { resolveTemplateBreakMinutes } from "./break-config";

describe("resolveTemplateBreakMinutes — pípanie prestávok, krok 1", () => {
  it("breakMode 'minuty' → vráti breakMinutes priamo, časy sa ignorujú", () => {
    expect(resolveTemplateBreakMinutes({ breakMode: "minuty", breakMinutes: 30, breakStartTime: "11:00:00", breakEndTime: "13:00:00" })).toBe(30);
  });

  it("breakMode 'presny_cas' → vypočíta rozdiel od–do (11:00–13:00 = 120 min)", () => {
    expect(resolveTemplateBreakMinutes({ breakMode: "presny_cas", breakMinutes: 30, breakStartTime: "11:00:00", breakEndTime: "13:00:00" })).toBe(120);
  });

  it("breakMode 'presny_cas' s menšími jednotkami (12:15–12:45 = 30 min)", () => {
    expect(resolveTemplateBreakMinutes({ breakMode: "presny_cas", breakMinutes: 30, breakStartTime: "12:15:00", breakEndTime: "12:45:00" })).toBe(30);
  });

  it("breakMode 'presny_cas' BEZ vyplnených časov (nekonzistentné dáta) → fail-safe na breakMinutes", () => {
    expect(resolveTemplateBreakMinutes({ breakMode: "presny_cas", breakMinutes: 45, breakStartTime: null, breakEndTime: null })).toBe(45);
  });

  it("breakMode 'presny_cas' s neplatným rozsahom (koniec pred začiatkom) → fail-safe na breakMinutes", () => {
    expect(resolveTemplateBreakMinutes({ breakMode: "presny_cas", breakMinutes: 30, breakStartTime: "13:00:00", breakEndTime: "11:00:00" })).toBe(30);
  });
});

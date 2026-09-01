import { describe, expect, it } from "vitest";
import type { RejectedCandidate } from "./generate";
import { explainCandidates } from "./format";

/**
 * Blok 9c Piece 4 (🔍) — rozlíšiť "nikdy nemal šancu"
 * (kód pravidla) od "prehral na skóre" (`SCORE`) v ľudsky čitateľnom texte.
 */

describe("explainCandidates", () => {
  it("prázdny zoznam → prázdny text", () => {
    expect(explainCandidates([])).toBe("");
  });

  it("kandidáti zamietnutí PRAVIDLOM (diera) — vypíše meno a presný dôvod pre KAŽDÉHO", () => {
    const candidates: RejectedCandidate[] = [
      { employeeId: "e1", name: "Jana", blockedBy: "MIN_REST_DAILY", detail: "Odpočinok by bol 9.0 h (min. 12 h).", shortfall: 3, shortfallUnit: "hours" },
      { employeeId: "e2", name: "Andrej", blockedBy: "BLOCK_LENGTH", detail: "Pracuje v 5-dňových blokoch — tento deň by bol 6. v rade.", shortfall: 1, shortfallUnit: "days" },
      { employeeId: "e3", name: "Peter", blockedBy: "ABSENCE", detail: "Neprítomnosť v tento deň (dovolenka/PN/OČR).", shortfall: null, shortfallUnit: null },
    ];
    const text = explainCandidates(candidates);
    expect(text).toBe(
      "Jana: Odpočinok by bol 9.0 h (min. 12 h). Andrej: Pracuje v 5-dňových blokoch — tento deň by bol 6. v rade. Peter: Neprítomnosť v tento deň (dovolenka/PN/OČR).",
    );
    // Žiadna zmienka o skóre — tu nikto ani nemohol súťažiť.
    expect(text).not.toContain("skóre");
  });

  it("kandidát, ktorý PREHRAL NA SKÓRE — jasne oddelené od 'nikdy nemal šancu', BEZ kódu pravidla", () => {
    const candidates: RejectedCandidate[] = [
      { employeeId: "e2", name: "Peter", blockedBy: "SCORE", detail: "Iný kandidát mal nižšie (výhodnejšie) skóre férovosti.", shortfall: null, shortfallUnit: null },
    ];
    const text = explainCandidates(candidates);
    expect(text).toBe("Vhodní, ale s horším skóre férovosti: Peter.");
  });

  it("KOMBINÁCIA — niekto nikdy nemal šancu (kód), niekto iný len prehral na skóre — text ich drží oddelene", () => {
    const candidates: RejectedCandidate[] = [
      { employeeId: "e1", name: "Andrej", blockedBy: "MAX_SHIFT_HOURS", detail: "§ZP: max. dĺžka smeny 12 h — táto má 13.0 h.", shortfall: 1, shortfallUnit: "hours" },
      { employeeId: "e2", name: "Peter", blockedBy: "SCORE", detail: "Iný kandidát mal nižšie (výhodnejšie) skóre férovosti.", shortfall: null, shortfallUnit: null },
      { employeeId: "e3", name: "Zuzana", blockedBy: "SCORE", detail: "Iný kandidát mal nižšie (výhodnejšie) skóre férovosti.", shortfall: null, shortfallUnit: null },
    ];
    const text = explainCandidates(candidates);
    expect(text).toBe(
      "Andrej: §ZP: max. dĺžka smeny 12 h — táto má 13.0 h. Vhodní, ale s horším skóre férovosti: Peter, Zuzana.",
    );
  });
});

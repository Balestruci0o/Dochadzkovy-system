import type { RejectedCandidate } from "./generate";

/**
 * Blok 9c Piece 4 (🔍) — chybové hlásenie musí byť
 * KONKRÉTNE, nie "Nepodarilo sa vygenerovať rozvrh." Rozlišuje dve úplne
 * odlišné situácie, ktoré `candidatesRejected`/`candidatesConsidered` môžu
 * obsahovať naraz:
 *   - "nikdy nemal šancu" — vyradil ho KONKRÉTNY kód pravidla (MIN_REST_DAILY,
 *     BLOCK_LENGTH, ABSENCE, POSITION, ...) — bol by aj tak vhodný, len keby
 *     to pravidlo neplatilo.
 *   - "prehral na skóre" (`blockedBy: "SCORE"`) — BOL vhodný, hard filter
 *     prešiel, len iný kandidát mal výhodnejšiu (férovejšiu) kombináciu
 *     fondu/hodín/víkendov. Toto NIE je problém, ktorý treba riešiť — je to
 *     len vysvetlenie, prečo vyhral niekto iný.
 */
export function explainCandidates(candidates: RejectedCandidate[]): string {
  if (candidates.length === 0) return "";

  const scoreLosers = candidates.filter((c) => c.blockedBy === "SCORE");
  const neverHadChance = candidates.filter((c) => c.blockedBy !== "SCORE");

  const parts: string[] = [];
  if (neverHadChance.length > 0) {
    parts.push(neverHadChance.map((c) => `${c.name}: ${c.detail}`).join(" "));
  }
  if (scoreLosers.length > 0) {
    parts.push(`Vhodní, ale s horším skóre férovosti: ${scoreLosers.map((c) => c.name).join(", ")}.`);
  }
  return parts.join(" ");
}

/**
 * Blok 15 — `employee_pairings.employee_a_id < employee_b_id` je vynútené
 * CHECK constraintom v DB (migrácia 0034), takže appka MUSÍ pred každým
 * insertom/lookupom zoradiť dvojicu rovnako, nech (Marta, Zuzana) aj
 * (Zuzana, Marta) zadané v UI trafia ten istý riadok. Jediné miesto, ktoré
 * toto poradie robí — nikdy nezoraďuj ID inde nezávisle (napr. `.sort()` na
 * poli s iným porovnávačom by mohlo dať iný výsledok pre rovnaké UUID).
 */
export function sortPairIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

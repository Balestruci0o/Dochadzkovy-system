# Screenshoty pre nápovedu

Tieto obrázky sa **negenerujú ručne** — vznikajú skriptom
`scripts/screenshots/` (`npm run screenshots`). Presný zoznam (kľúč,
cesta, rola, aký stav treba navodiť) je v
[`scripts/screenshots/targets.ts`](../../../scripts/screenshots/targets.ts)
— jeden zdroj pravdy, rovnaký, aký číta aj samotný skript, takže sa
nemôže rozísť s tým, čo appka skutočne vyfotí.

Kompletný návod (predpoklady, príkaz, ako pridať nový obrázok, ustálenie
času, čo sa dá a nedá zaručiť naprieč behmi) je v
[`docs/SCREENSHOTS.md`](../../../docs/SCREENSHOTS.md).

Kontrola súladu (každý `screenshot` kľúč z `lib/help/content.ts` má tu
súbor a naopak) beží ako súčasť auditu tejto fázy — výsledok je v
`NALEZY.md`, nie tu, aby sa táto poznámka nemusela ručne udržiavať pri
každej zmene.

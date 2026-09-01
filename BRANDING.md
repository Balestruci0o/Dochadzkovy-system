# Prispôsobenie značky

Značka appky (logo, názvy, farby) sa nastavuje v troch nezávislých
vrstvách — žiadna z nich nevyžaduje editovať `.tsx` súbor:

| Čo | Kde | Treba build? |
|---|---|---|
| Logo | `public/branding/logo.svg` | nie |
| Názvy a texty | `.env.local`, `NEXT_PUBLIC_BRAND_*` | áno |
| Farby a zaoblenie | `app/branding.css` | áno |

## Logo

Prepíš `public/branding/logo.svg` vlastným súborom (rovnaká cesta) — appka
ho zobrazí okamžite pri ďalšom requeste, bez rebuildu. Ak chceš logo na inej
ceste (napr. `.png` alebo iný priečinok), nastav `NEXT_PUBLIC_BRAND_LOGO` v
`.env.local` (to už build vyžaduje, viď nižšie).

Odporúčania pre vlastné logo:
- **štvorcový `viewBox`** (rovnaká šírka a výška) — appka ho vykresľuje ako
  štvorec cez `next/image`,
- **bez pevných `width`/`height`** v samotnom SVG — o veľkosť sa stará
  appka,
- **bez textu** — názov firmy sa vypisuje samostatne vedľa loga
  (`NEXT_PUBLIC_BRAND_APP_NAME` nižšie), duplicitný text v logu by sa
  zdvojil,
- **`stroke="currentColor"` / `fill="currentColor"`**, nech logo prevezme
  farbu textu okolo seba a funguje aj v prípadnom tmavom režime.

## Názvy a texty

V `.env.local` (skopírovaný z `.env.example`):

```
NEXT_PUBLIC_BRAND_NAME=Vaša Firma s.r.o.
NEXT_PUBLIC_BRAND_SHORT_NAME=Vaša Firma
NEXT_PUBLIC_BRAND_TAGLINE=
NEXT_PUBLIC_BRAND_APP_NAME=Dochádzka
NEXT_PUBLIC_BRAND_LOGO=
```

Všetko je voliteľné — bez vyplnenia appka beží pod neutrálnym názvom
"Dochádzka". `NEXT_PUBLIC_BRAND_TAGLINE` prázdne = v bočnom paneli sa
nezobrazí vôbec (nie prázdny riadok).

**Tieto premenné Next.js dosadzuje PRI BUILDE**, nie za behu — po zmene
hodnoty treba spustiť `npm run build` nanovo, samotný reštart servera
nestačí.

## Farby a zaoblenie

`app/branding.css` je šablóna s celou paletou appky, no v predvolenom stave
**celá zakomentovaná** (no-op — appka beží s pôvodnou paletou). Odkomentuj a
uprav len to, čo chceš zmeniť.

Príklad — zmena hlavnej akčnej farby (tlačidlá, aktívne stavy):

```css
:root {
  --color-orange: #2563eb;
  --color-orange-dark: #1d4ed8;
  --color-orange-tint: #dbeafe;
}
```

Po zmene treba `npm run build` (rovnaký dôvod ako pri `NEXT_PUBLIC_*` —
Tailwind vygeneruje utility triedy pri builde).

**Nikdy needituj `app/globals.css` priamo.** Je to zdieľaný súbor appky —
pri aktualizácii na novšiu verziu (`git pull`) by úpravy v ňom viedli ku
konfliktom. `app/branding.css` sa načíta AŽ PO `globals.css` a prebíja ho
cez CSS cascade — celá vlastná paleta patrí tam.

**⚠️ Stavové farby nesú význam, nielen vzhľad:** `--color-ok` (zelená = v
poriadku), `--color-late` (teplá farba = meškanie/problém) a
`--color-absent` (sivá = neprítomnosť) používa appka naprieč kalendárom aj
výkazmi na signalizáciu stavu. Ak ich meníš, zachovaj rozlíšiteľnosť a
očakávanú sémantiku — inak si zamestnanci a manažéri budú kalendár čítať
nesprávne.

## Názov firmy v databáze — to je iná vec

Tabuľka `organizations` (stĺpec `name`, nastavuje sa pri `npm run setup`)
je **dáta**, nie branding — objaví sa vo výkazoch, PDF exportoch a
oficiálnych dokumentoch. Branding vyššie je len vizuálna vrstva UI (hlavička,
prihlasovacia stránka, emaily). Pri inštalácii nastav oboje na rovnakú
hodnotu, nech appka pôsobí súvisle.

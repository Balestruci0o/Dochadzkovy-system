# Screenshoty

Ako vzniknú obrázky v `public/help/screenshots/` (ilustrácie k návodom v
`/pomoc`) a `docs/screenshots/` (obrázky v `README.md`) — oboje generuje
`scripts/screenshots/` (Playwright), nič sa nefotí ručne.

## Predpoklady

Rovnaké ako pre bežný lokálny vývoj (`docs/DEVELOPMENT.md`) — Docker,
lokálny Supabase stack. Naviac:

- `npx playwright install chromium` (raz, po `npm install` — `@playwright/test`
  je vývojová závislosť, samotnú binárku prehliadača si Playwright sťahuje
  zvlášť).
- `DEV_DISABLE_2FA=true` v `.env.local` (dočasne — kôli majiteľovi, ktorý má
  2FA vždy zapnuté). Bez toho sa skript ihneď zastaví so zrozumiteľnou
  chybou namiesto tichého zaseknutia na `/2fa/overit` — čítanie OTP kódu
  z konzoly automatizovane je krehšie (viazané na presný formát
  `[email:stub]` výpisu) než jeden riadok v `.env.local`, ktorý sa po
  fotení zase zakomentuje.

## Ako sa sada vygeneruje

```
npm run dev:bootstrap -- --reset
npm run dev:accounts-photo
npm run dev
```

V druhom termináli (appka musí bežať):

```
npm run screenshots
```

Trvá to približne 1-2 minúty pre celú sadu (45 obrázkov — 19 kľúčov z
`lib/help/content.ts` × 2 rozlíšenia + 7 pre README, z toho 6 len desktop
a 1 len mobil). Skript sa prihlási raz za rolu (majiteľ/manažér/zamestnanec,
presne tí traja z `npm run dev:accounts-photo`) a odfotí všetko pod danou
rolou naraz — nie prihlásenie pred každým obrázkom zvlášť.

**Prečo presne toto poradie príkazov:** `--reset` zahodí staré dáta, ale
`npm run dev:accounts-photo` (nastavuje manažérovi PLNÚ sadu granulárnych
pravomocí, inak by mal poloprázdne Nastavenia) sa NEPAMÄTÁ cez reset —
treba ho spustiť znova PO každom `--reset`, nie len raz.

Prepínače: `--only=<kľúč>` (jeden konkrétny obrázok, najrýchlejšie pri
ladení), `--role=owner|manager|employee`, `--desktop-only`, `--mobile-only`
— dajú sa kombinovať.

Ak jeden cieľ zlyhá, skript pokračuje ďalej a na konci vypíše zoznam
zlyhaní aj s dôvodom — nepadá pri prvej chybe.

## Ustálený čas — a čo sa ustáliť NEDÁ

Skript zmrazí hodiny STRÁNKY (Playwright `page.clock`, `scripts/screenshots/config.ts`)
na **11:00 v deň behu, miestneho času** — dopoludnia, keď je ranná zmena
už v práci, ale deň ešte nekončí. Toto stabilizuje KLIENTSKY počítané
relatívne časy (napr. odznak notifikácií, countdown na `/punch`).

Čo sa TAKTO zmraziť nedá: appka je väčšinou server-rendered (Next.js
Server Components) a server (`npm run dev` proces) beží MIMO prehliadača
— jeho `new Date()` (dnešný dátum v Prehľad dňa, mesačné defaulty vo
Výkazoch/Kalendári) je vždy skutočný reálny čas behu, nie ten zmrazený.
Preto sa sada spolieha na iný mechanizmus: **demo dáta (`lib/db/seed-schedule.ts`)
sú generované relatívne k "dnes" PRI SEEDE** (`todayDay = new Date().getDate()`),
takže pokým sa foti tesne po `--reset` (rovnaký deň), server aj dáta
"vidia" ten istý deň a obrázky vyzerajú zmysluplne (nedávne pípnutia,
žiadosti ±N dní od dneška, aktuálny/budúci mesiac v kalendári).

**"Reprodukovateľné" tu znamená "rovnaký výstup pre rovnaký stav
databázy", nie "bit-identické naprieč rôznymi dňami spustenia".** Spustenie
o týždeň neskôr (po novom `--reset`) vygeneruje inak DATOVANÉ, ale rovnako
vyzerajúce obrázky — to je vlastnosť seedu (adaptuje sa na "dnes"), nie
chyba skriptu.

**Jediná trvalá výnimka, nedá sa obísť:** `qr-punch-screen.png`/`readme-qr-pipanie.png`.
QR kód kóduje jednorazový token s anti-replay `jti` — server vydá NOVÝ token pri každom načítaní
stránky, bez ohľadu na zmrazený klientský čas. Skúška reprodukovateľnosti
(dva behy po sebe, BEZ reseedu medzi nimi) potvrdila presne toto: zo 45
súborov sa líšili len tieto dva, bajt po bajte identické zvyšných 43.

### Známe obmedzenie: reprodukovateľnosť platí len V RÁMCI JEDNÉHO DŇA

Zmrazený je LEN klientský čas stránky (`page.clock`, vyššie). Server
(`npm run dev` proces) aj demo dáta (`lib/db/seed-schedule.ts`, generované
pri `--reset` relatívne k reálnemu dátumu behu) bežia na SKUTOČNOM,
nezmrazenom dátume systému. Sada je preto bajt-po-bajte reprodukovateľná
LEN medzi dvoma behmi TOHO ISTÉHO dňa (bez reseedu medzi nimi) — presne
to overuje skúška reprodukovateľnosti vyššie, nič viac.

**Čo z toho konkrétne vyplýva pri opätovnom generovaní o deň/týždeň/mesiac
neskôr** (po novom `npm run dev:bootstrap -- --reset`):

- Viditeľné dátumy (nadpis "St 27. augusta 2026", dátumy v zoznamoch
  pípnutí/žiadostí, číslo dňa zvýraznené ako "dnes" v kalendári) budú iné
  — posunuté na nový reálny dátum. To je OČAKÁVANÉ, nie regresia.
- `git diff` na commitnuté `.png` súbory preto ukáže zmenu PRI KAŽDOM
  pregenerovaní, aj keď sa appka aj demo dáta štrukturálne nezmenili vôbec
  — čisto kvôli posunutému dátumu. Kto reviduje takýto commit, nech
  neočakáva "žiadna zmena v appke = žiadny diff v obrázkoch".
- Deň v týždni sa mení, takže aj TVAR mesiaca v kalendárových
  screenshotoch (ktorý deň pripadne na pondelok, koľko riadkov zaberie)
  sa mierne líši medzi behmi — obsahovo rovnocenné, vizuálne nie
  identické.
- Skúška reprodukovateľnosti (`npm run screenshots` dvakrát PO SEBE, BEZ
  reseedu medzi behmi) zostáva správny spôsob, ako overiť, že SAMOTNÝ
  skript je deterministický — nie spôsob, ako overiť zhodu s predošlým
  commitom z iného dňa.

## Ako pridať nový obrázok

1. Pridaj krok so `screenshot: "<kluc>"` do `lib/help/content.ts` (nápoveda)
   alebo si vyber kľúč pre README.
2. Pridaj záznam do `TARGETS` v `scripts/screenshots/targets.ts` — cesta,
   rola, text na čakanie (`readyText`, viditeľný text dôkazujúci vykreslený
   obsah — NIE fixný `waitForTimeout`) a prípadne `prepareState` (S2 krok,
   pozri `scripts/screenshots/prepare.ts` pre vzory: otvorenie dialógu,
   vyplnenie/klik pred odfotením).
3. `npm run screenshots -- --only=<kluc>`, over výsledok okom.
4. Ak kľúč patrí do nápovedy, skontroluj že `public/help/screenshots/`
   obsahuje presne toľko súborov, koľko je kľúčov v `content.ts` (žiaden
   osirotený, žiaden chýbajúci) — to isté očakáva aj audit v `NALEZY.md`.

## Kedy sa sada MUSÍ pregenerovať

- Zmena UI na stránke, ktorá má svoj screenshot (aj drobná — farba, text
  tlačidla, ktorý návod cituje doslovne).
- Zmena značky (`NEXT_PUBLIC_BRAND_*`, `BRANDING.md`) — screenshoty by inak
  ukazovali inú značku než appka práve beží.
- Zmena demo dát (`lib/db/seed.ts`, `lib/db/seed-schedule.ts`) — najmä mená,
  pozície, alebo presuny toho, KTO má akú vlastnosť (napr. ktorý zamestnanec
  má `canPunchWeb`, ktorý manažér má plné pravomoci).

## Čo sa nedá vygenerovať automaticky

Nič — všetkých 45 obrázkov (19 nápoveda × 2 rozlíšenia + 7 README) vzniká
skriptom. Žiadny ručný krok nezostáva.

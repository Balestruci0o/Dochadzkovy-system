# Ako prispieť

Ďakujeme za záujem prispieť do tohto projektu. Tento dokument popisuje, ako
nahlásiť chybu, navrhnúť zmenu, rozbehnúť si vývojové prostredie a aké
konvencie tu platia.

## Prehlásenie prispievateľa (CLA)

Tento projekt je licencovaný pod AGPL-3.0-or-later (pozri `LICENSE`), ale
autor projektu ho aj **predáva pod komerčnou licenciou** tým, čo chcú
systém uzavrieť alebo nasadiť inak, než AGPL dovoľuje (pozri `NOTICE`).
Aby to bolo možné aj s kódom od prispievateľov, každý príspevok musí byť
licencovaný o niečo šírejšie než „len AGPL".

Preto pri každom commite, ktorý posielaš do tohto projektu, potvrdzuješ
(pripojením `Signed-off-by:` riadku, `git commit -s`) **oboje**:

1. **Pôvod kódu (DCO)** — že príspevok je tvoja vlastná práca (alebo máš
   právo ju odoslať), a že ho odosielaš pod licenciou tohto projektu.
2. **Udelenie práv autorovi projektu** — že popri tom autorovi projektu
   udeľuješ právo šíriť tvoj príspevok AJ pod inou licenciou než AGPL
   (vrátane komerčnej licencie spomenutej vyššie). **Autorské práva k
   tvojmu príspevku si ponechávaš ty** — toto je len dodatočné povolenie
   pre autora projektu, nie prevod vlastníctva.

Ak s bodom 2 nesúhlasíš, môžeš stále nahlasovať chyby a diskutovať v
issues — len kód, ktorý by sme mergli, musí mať toto potvrdenie.

Formálne znenie `Signed-off-by:` riadku (Git ho pridá automaticky s `-s`):

```
Signed-off-by: Tvoje Meno <tvoj@email.sk>
```

## Ako nahlásiť chybu

Použi šablónu chyby (`.github/ISSUE_TEMPLATE/`). Čím presnejšie popíšeš, ako
chybu zreprodukovať, tým rýchlejšie sa dá opraviť. Bezpečnostnú chybu **sem
nepatrí** — pozri `SECURITY.md`.

## Ako navrhnúť zmenu

Menšie zmeny (oprava chyby, malé vylepšenie) rovno ako Pull Request. Väčšie
zmeny (nová funkcia, zmena architektúry) najprv ako issue na prediskutovanie
— ušetrí to prácu, ak by sa smer ukázal ako nesprávny.

## Vývojové prostredie

**Odporúčaná cesta:** [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) —
`npm install`, skopírovať `.env.development.example` do `.env.local`,
`npm run dev:bootstrap`. Rozbehne lokálny Supabase stack cez Docker (nič
netreba zakladať v cloude) a rovno založí realistický mesiac demo dát
(niekoľko zamestnancov, vygenerovaný a zverejnený rozvrh, pípnutia,
žiadosti vo všetkých stavoch) — najrýchlejšia cesta k appke s dátami na
hranie sa, aj k spusteniu celej testovacej sady (`npm run test:db`).

Ak namiesto toho chceš vyskúšať appku proti skutočnému (cloudovému alebo
self-hosted) Supabase projektu — presne tak, ako ju uvidí prevádzkovateľ
pri prvej inštalácii — postupuj podľa [`docs/INSTALL.md`](docs/INSTALL.md)
a `npm run setup` namiesto `npm run db:seed`.

## Konvencie

- **Jazyk:** kód (premenné, funkcie, súbory) po anglicky, UI texty aj
  komentáre po slovensky — tak ako v celom repozitári.
- Pred odoslaním: `npm run lint` a `npm run typecheck` bez chýb.
- `npm run test:unit` musí prejsť (nepotrebuje databázu). `npm run test:db`
  potrebuje bežiaci Postgres — najjednoduchšie cez `npm run dev:bootstrap`
  (lokálny Supabase stack, `docs/DEVELOPMENT.md`), ktorý dá bežať **všetkým**
  48 súborom vrátane 9, čo v CI bežať nemôžu (potrebujú skutočný Supabase
  Auth admin API a rolu `authenticated`, nielen holý Postgres kontajner —
  vanilla `postgres:16` bez Supabase stacku tých 9 zlyhá; presne preto sú z
  automatického CI behu vynechané, `.github/workflows/ci.yml`).
- Ak zmena zasiahne obrazovku, ktorá má screenshot v nápovede alebo v
  `README.md`, pregeneruj ho (`npm run screenshots`, návod v
  `docs/SCREENSHOTS.md`) — ináč sa obrázok rozíde so skutočným UI.
- Zmeny zapisuj do [`CHANGELOG.md`](CHANGELOG.md).

## Nemenné princípy projektu

Skôr než začneš meniť čokoľvek okolo databázy, RLS, pípnutí alebo
generátora rozvrhu, over si, že zmena rešpektuje základné princípy
projektu. Veci ako „RLS je primárna vrstva, nie aplikačná kontrola" alebo
„pípnutia sa needitujú, len dopĺňajú opravou" nie sú vec vkusu ani štýlu —
sú to vedomé, zdôvodnené rozhodnutia a Pull Request, ktorý ich poruší, sa
nezlúči bez ohľadu na to, aký je inak dobrý.

# Bezpečnostná politika

*For an English summary: this project's security policy is written in
Slovak. To report a vulnerability, email the address in section 2 below
("Ako nahlásiť zraniteľnosť") — do not open a public GitHub issue. State
that you don't read Slovak and a translated reply will follow.*

Tento systém spracúva osobné údaje zamestnancov a mzdové podklady. Berieme
to vážne — ak nájdeš bezpečnostnú chybu, ďakujeme, že nám dáš šancu ju
opraviť skôr, než sa dozvie niekto iný.

## 1. Podporované verzie

| Verzia | Podporovaná |
|---|---|
| 1.x | ✅ |

Projekt je zatiaľ len pri prvej major verzii — bezpečnostné opravy idú do
najnovšej `1.x`.

## 2. Ako nahlásiť zraniteľnosť

**Nezakladaj na ňu verejný GitHub issue.** Zraniteľnosť, ktorá je verejne
viditeľná pred opravou, je zraniteľnosť, ktorú môže niekto zneužiť skôr,
než dostaneme šancu ju opraviť.

Nahlás ju mailom na: **support@martin-pavlik.com**

Napíš čo najkonkrétnejšie: čo si našiel, ako to zreprodukovať, a čo si
myslíš, že je dôsledok (napr. „manažér vidí zamestnancov inej prevádzky"
je konkrétnejšie a užitočnejšie než „RLS je rozbité").

Orientačná doba odozvy: **do 5 pracovných dní** na prvé potvrdenie, že
sme hlásenie prijali. Tento projekt spravuje jeden človek, nie tím s
bezpečnostným oddelením — doba opravy sa bude líšiť podľa závažnosti, ale
sľubujeme rýchlu prvú reakciu, nie okamžitú opravu.

## 3. Bezpečnostný model

Stručne, čo systém robí a prečo — podrobnejšie v
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md):

- **Izolácia dát medzi prevádzkami a organizáciami je vynútená v databáze
  cez Row Level Security (RLS)**, nie len v aplikačnej logike. Chyba v API
  kóde preto nevedie k úniku cudzích dát — Postgres sám odfiltruje riadky,
  ku ktorým prihlásený používateľ nemá prístup.
- **Appka pri bežnej prevádzke pripája do databázy pod obmedzenou rolou
  `app_user`** (`NOSUPERUSER NOBYPASSRLS`), nikdy pod vlastníkom schémy —
  keby bežala pod vlastníkom, RLS by sa nikdy nevyhodnotilo.
- **Pípnutia príchodov a odchodov sú nemenné** — `punch_events` sa needituje
  ani nemaže (vynútené DB triggerom, nielen aplikačnou konvenciou). Oprava
  chybného pípnutia je vždy NOVÝ záznam s odkazom na pôvodný, nikdy prepis.
- **Terminál sa autentifikuje HMAC-SHA256 podpisom** nad kanonickou
  správou, s ochranou proti opakovaniu (rotujúci QR token s krátkou
  platnosťou, jednorazovo použiteľný `jti`).
- **Tajomstvá terminálov sú v databáze šifrované** (AES-256-GCM), nie len
  hashované — server ich musí vedieť dešifrovať, aby si sám prepočítal
  HMAC podpis a overil ho.
- **Každá zmena dochádzky a mzdových údajov je v audit logu**, zapisovanom
  DB triggerom (nedá sa obísť z aplikačného kódu).

Doplňujúce opatrenia, tiež overené priamo v kóde:
- Rate limiting na prihlasovanie a na `/api/punch` (DB-based, nie len
  aplikačná pamäť — prežije reštart).
- Dvojfaktorové overenie (jednorazový kód mailom) je povinné pre rolu
  `owner` pri prihlásení.
- GPS pri pípaní cez web je **len informatívny signál** — nikdy neblokuje
  pípnutie, len označí záznam ako podozrivý na kontrolu manažérom (dá sa
  ľahko podvrhnúť, preto sa naň nedá spoliehať ako na dôkaz).

## 4. Čo je zodpovednosť prevádzkovateľa

Systém je open source a nasadzuje si ho každý sám (alebo cez platenú
inštaláciu — pozri `README.md`). Nasledovné je mimo toho, čo kód môže
vynútiť sám za teba:

- **Vygeneruj si vlastné tajomstvá pre KAŽDÚ inštaláciu** (`QR_TOKEN_SECRET`,
  `TERMINAL_SECRET_ENCRYPTION_KEY`, `CRON_SECRET`, heslo `app_user` role) —
  nikdy ich neprepoužívaj medzi rôznymi nasadeniami (napr. produkcia a
  testovacie/staging prostredie). Presné príkazy sú v `.env.example`.
- **`DEV_ACCOUNTS_PASSWORD` a `DEV_DISABLE_2FA` nesmú byť v produkcii
  nastavené nikdy.** `DEV_DISABLE_2FA` je aj tak tvrdo ignorovaný, keď
  `NODE_ENV=production` — ale nezáväzuj sa na to, jednoducho ho v produkcii
  nikdy nenastavuj.
- **Zálohy databázy** — appka sama zálohy nerobí, je to vec tvojho
  Postgres/Supabase nasadenia.
- **HTTPS** — appka aj terminál musia komunikovať cez HTTPS/TLS; appka sama
  transport nezabezpečuje (to rieši reverzná proxy alebo hosting platforma).

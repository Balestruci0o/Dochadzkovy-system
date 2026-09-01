# Inštalácia

Podrobný návod na **skutočné nasadenie** systému pre novú firmu (cloudový
alebo self-hosted Supabase projekt, produkčné tajomstvá). `README.md` má
len skrátený prehľad krokov — tento dokument ich vysvetľuje. Ak chceš
appku len vyskúšať alebo na nej lokálne vyvíjať, choď namiesto toho do
[`docs/DEVELOPMENT.md`](DEVELOPMENT.md) — je to rýchlejšie (jeden príkaz,
Docker, nič netreba zakladať v cloude) a nedotýka sa produkčných dát.

**Poznámka k zdroju pravdy pre databázovú schému:** skutočne sa spúšťajú
migrácie v `lib/db/migrations/` (krok `npm run db:migrate` nižšie).
`schema.sql` v koreni repozitára je generovaný čitateľný prehľad celej
schémy vrátane RLS (`pg_dump --schema-only` proti čistej DB po migráciách,
presný príkaz je v jeho vlastnej hlavičke) — needituje sa ručne a pri
pridaní novej migrácie sa má vygenerovať nanovo. Pri akomkoľvek rozpore
(napr. ak ho niekto zabudne po migrácii obnoviť) rozhodujú vždy migrácie.

## 1. Požiadavky

- **Node.js** — `^18.18.0 || ^19.8.0 || >= 20.0.0` (vyžaduje Next.js 15).
  Skripty projektu (`npm run setup`, `npm run db:seed`) navyše používajú
  natívny prepínač `--env-file`, ktorý potrebuje **Node 20.6+** — v praxi
  teda odporúčame rovno Node 20 LTS alebo novší.
- **PostgreSQL 15+** s rozšíreniami `pgcrypto` a `btree_gist` (zakladajú sa
  automaticky prvou migráciou, netreba ich pripravovať ručne — len ich DB
  rola, pod ktorou migrácie bežia, musí smieť `CREATE EXTENSION`).
- **Supabase projekt** — cloud (supabase.com) alebo self-hosted. Appka
  používa Supabase len na Auth (prihlásenie, email-OTP 2FA pre ownera,
  pozvánky); samotné dáta idú priamo do Postgresu cez Drizzle, nie cez
  Supabase klienta. Supabase Storage v kóde zatiaľ nie je zapojený (tabuľka
  `absence_attachments` na prílohy k PN existuje v schéme, ale appka ju
  nikde nečíta ani nezapisuje).
- **Resend účet** — voliteľný. Bez neho appka funguje, len namiesto
  odosielania mailov (pozvánky, reset hesla, notifikácie) len vypíše ich
  obsah do server konzoly.

## 2. Založenie Supabase projektu

1. Založ nový projekt na [supabase.com](https://supabase.com) (alebo
   self-hosted inštanciu).
2. V nastaveniach projektu (sekcia API / API Keys) nájdeš tri hodnoty pre
   `.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - **service_role / secret key** → `SUPABASE_SECRET_KEY` (nikdy neposielaj
     do prehliadača, len server-side)
3. V nastaveniach databázy (sekcia Database) nájdeš pripájací reťazec
   Postgresu — z neho sa odvodia `DATABASE_URL` aj `APP_DATABASE_URL` (viď
   nižšie, líšia sa len rolou/heslom v connection stringu).
4. Presné názvy sekcií v Supabase administrácii sa môžu časom meniť — hľadaj
   "API keys" a "Database connection string/URI".

Skopíruj `.env.example` do `.env.local` a vyplň aspoň Supabase sekciu a
`DATABASE_URL`.

## 3. Databáza

Appka pripája do Postgresu pod **dvomi rôznymi rolami** a poradie krokov nižšie
je záväzné:

```
npm run db:migrate
node --env-file=.env.local scripts/setup-app-role-password.mjs
npm run setup
```

1. **`npm run db:migrate`** — spustí sa pod `DATABASE_URL` (vlastník schémy,
   Supabase rola `postgres`, `rolbypassrls = true`). Založí všetky tabuľky,
   RLS politiky, triggery.
2. **`node --env-file=.env.local scripts/setup-app-role-password.mjs`** —
   nastaví heslo appkovej role `app_user` (nastaví ho migrácia, ale bez
   hesla) na hodnotu z `APP_DB_PASSWORD`. Bez tohto kroku sa appka nevie k DB
   pripojiť pod `APP_DATABASE_URL`. Na rozdiel od `npm run setup`/
   `npm run db:seed` to nie je `npm` skript, takže `--env-file` treba
   uviesť ručne — bez neho skript zlyhá s `APP_DB_PASSWORD nie je
   nastavená`, aj keď je premenná v `.env.local` vyplnená.
3. **`npm run setup`** — interaktívne založí prvú organizáciu, prevádzku a
   majiteľa (podrobnosti nižšie).

**Prečo dve roly:** RLS politiky (izolácia dát medzi prevádzkami a
organizáciami) sa vyhodnocujú LEN pre rolu `app_user`
(`NOSUPERUSER NOBYPASSRLS`) — appka pri bežnej prevádzke MUSÍ pripájať pod
touto rolou (`APP_DATABASE_URL`), nikdy pod vlastníkom schémy
(`DATABASE_URL`). Keby appka bežala pod vlastníkom, RLS by sa nikdy
nevyhodnotilo a všetci by videli dáta všetkých prevádzok — to je presne
dôvod, prečo je to v kóde vynútené (`lib/db/index.ts` číta výhradne
`APP_DATABASE_URL`, `lib/db/admin.ts` s `DATABASE_URL` sa smie použiť len na
úzko vymenovaných miestach — migrácie, seed/setup skripty, cron, punch
endpoint). Viď `docs/ARCHITECTURE.md`, "Model bezpečnosti".

### `npm run setup` — čo sa spýta

Interaktívne, krok za krokom: názov organizácie, IČO (voliteľné), kontakt na
podporu (dodávateľ systému, voliteľné), prvá prevádzka (názov, kód,
prevádzkové dni, časové pásmo) a majiteľ (meno, email, heslo — dvakrát,
overuje sa proti známym únikom hesiel). Pred zápisom vypíše súhrn a vyžiada
potvrdenie. Odmietne bežať, ak v databáze už existuje čo i len jedna
organizácia — nie je určený na opakované spúšťanie ani na pridávanie ďalšej
organizácie do existujúcej appky.

`--dry-run` prejde všetky kontroly a otázky, ale nič nezapíše — vhodné na
overenie, že premenné prostredia a pripojenie do DB fungujú.

## 4. Tajomstvá

Vygeneruj NOVÉ hodnoty pre KAŽDÚ inštaláciu, nikdy sa neprepoužívajú medzi
nasadeniami:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
— pre `QR_TOKEN_SECRET` a `TERMINAL_SECRET_ENCRYPTION_KEY` (appka pri štarte
overuje, že majú presne 32 bajtov po dekódovaní z base64).

```
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
— pre `CRON_SECRET` (formát nie je pevný, len sa porovnáva ako reťazec).

**⚠️ Varovanie:** zmena `TERMINAL_SECRET_ENCRYPTION_KEY` za behu (napr. pri
rotácii tajomstva) znefunkční **všetky existujúce zaregistrované terminály**
— ich uložené tajomstvo (`terminals.secret_hash`) je zašifrované starým
kľúčom a s novým kľúčom sa už nedá dešifrovať (overené v
`lib/punch/hmac.ts`). Po zmene tohto kľúča treba všetky terminály
zaregistrovať nanovo. Terminálové pípanie zlyhá aj pri nesúlade
`QR_TOKEN_SECRET` (terminál overuje aj podpis QR kódu naskenovaného z
telefónu, nielen vlastný HMAC) — obe tajomstvá sú teda kritické pre funkčné
pípanie.

## 5. Cron úlohy

`vercel.json` definuje dve naplánované úlohy:

| Cesta | Rozvrh (UTC) | Čo robí |
|---|---|---|
| `/api/cron/auto-close` | `5 0 * * *` (denne o 00:05) | Uzavrie zmeny, kde zamestnanec odišiel na prestávku a nevrátil sa — nikdy nedomýšľa bežné "zabudol pípnuť odchod". |
| `/api/cron/generate-schedule` | `0 3 * * *` (denne o 03:00) | Sám si overí, či je DNES presne 7 dní pred koncom mesiaca pre danú prevádzku — inak je to no-op. Beží denne zámerne (dĺžka mesiaca sa mení). |

Oba endpointy vyžadujú hlavičku `Authorization: Bearer <CRON_SECRET>`, inak
vrátia 401. Na Verceli ju cron runtime pridáva automaticky. Mimo Vercelu
(vlastný server) treba tie isté URL zavolať systemd timerom alebo klasickým
cronom:

```cron
# /etc/cron.d/dochadzka
5 0 * * * curl -fsS -X GET -H "Authorization: Bearer $CRON_SECRET" https://vasa-domena.sk/api/cron/auto-close
0 3 * * * curl -fsS -X GET -H "Authorization: Bearer $CRON_SECRET" https://vasa-domena.sk/api/cron/generate-schedule
```

alebo ako systemd timer, ktorý spúšťa jednotku s rovnakým `curl` príkazom.

## 6. Nasadenie

**Vercel (najkratšia cesta):** prepoj repozitár, nastav premenné prostredia
v nastaveniach projektu (presne tie z `.env.example`), `vercel.json` sa
postará o cron úlohy automaticky. Prvý deploy spustí `npm run build`.

**Vlastný server:** `npm run build` a potom `npm run start` za reverznou
proxy (nginx/Caddy) s TLS terminovaným na proxy. Cron úlohy treba nastaviť
ručne (bod 5 vyššie). `NEXT_PUBLIC_APP_URL` musí zodpovedať verejnej doméne.

## 7. Aktualizácia na novšiu verziu appky

```
git pull
npm ci
npm run db:migrate
npm run build
```

`app/branding.css` a `.env.local` sú tvoje vlastné súbory — tento postup ich
nemení (za predpokladu, že si `branding.css` neupravoval na tých istých
riadkoch, ktoré medzičasom zmenila samotná appka; `.env.local` git vôbec
nesleduje).

## 8. Riešenie problémov

**Appka sa spustí, ale nič nevidno (prázdne zoznamy).** Skontroluj, že
`APP_DATABASE_URL` skutočne smeruje na rolu `app_user`, nie omylom na tú
istú hodnotu ako `DATABASE_URL` — ak by appka bežala pod vlastníkom schémy,
RLS by sa nevyhodnocovalo (v tomto smere by si naopak videl VŠETKO, nie
nič — je to príznak opačného problému, over si to). Bežnejšia príčina
prázdnych zoznamov: `APP_DB_PASSWORD` nesedí s heslom v `APP_DATABASE_URL`
(zabudnutý krok 2 z bodu 3 vyššie) — vtedy sa appka k DB nepripojí vôbec a
zlyhá skôr, nie ticho.

**Maily nechodia.** Ak nie je nastavená `RESEND_API_KEY`, toto je OČAKÁVANÉ
správanie — appka maily namiesto odoslania len vypíše do server konzoly.
Skontroluj tiež, že doména v `EMAIL_FROM` je overená v Resende (Resend inak
odoslanie odmietne).

**Terminál nepípa.** Over zhodu `QR_TOKEN_SECRET` aj
`TERMINAL_SECRET_ENCRYPTION_KEY` medzi tým, čo appka aktuálne používa, a tým,
čo bolo nastavené pri registrácii terminálu — zmena ktoréhokoľvek z nich po
registrácii terminál rozbije (viď varovanie v bode 4).

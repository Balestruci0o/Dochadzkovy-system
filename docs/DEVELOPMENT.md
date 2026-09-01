# Lokálny vývoj

Návod, ako si appku rozbehnúť na vlastnom počítači — pre prispievateľa aj
pre teba o pol roka. Ak hľadáš návod na **skutočné nasadenie** appky pre
reálnu firmu (cloudový/self-hosted Supabase, produkčné tajomstvá), choď do
[`docs/INSTALL.md`](INSTALL.md) — tento dokument je výhradne o lokálnom
vývojovom prostredí (Docker, jednorazové demo dáta), nikdy sa nepoužíva na
produkčné nasadenie.

## 1. Predpoklady

- **Docker Desktop.** Na Windowse beží Docker Desktop nad WSL2 (Windows
  Subsystem for Linux) — je to Linuxové jadro bežiace priamo vo Windowse,
  cez ktoré Docker spúšťa kontajnery; bez zapnutého WSL2 sa Docker Desktop
  na Windowse nespustí. Docker Desktop pri inštalácii WSL2 zapne sám, len
  ho treba mať povolené vo Windows Features (bežné pri novšom Windowse).
- **Node.js** vo verzii z `package.json`/`docs/INSTALL.md` (`^18.18.0 ||
  ^19.8.0 || >= 20.0.0`, v praxi Node 20.6+ kvôli natívnemu `--env-file`).

Appka sama stiahne a naštartuje zvyšok (Postgres, Supabase Auth, Studio,
Mailpit) cez Supabase CLI (`npx supabase`, vývojová závislosť projektu) —
nemusíš si nič z toho inštalovať ručne ani zakladať účet v cloude.

## 2. Rozbehnutie

```
git clone <url-tohto-repozitára>
cd dochadzka
npm ci
cp .env.development.example .env.local
npm run dev:bootstrap
npm run dev
```

Otvor [http://localhost:3000/prihlasenie](http://localhost:3000/prihlasenie).

`npm run dev:bootstrap` naštartuje lokálny Supabase stack (Docker), aplikuje
migrácie a založí realistické demo dáta. **Prvé spustenie sťahuje niekoľko
GB Docker obrazov** (Postgres, Supabase Auth, Studio, Kong, Mailpit) — podľa
pripojenia to môže trvať niekoľko minút. Každé ďalšie spustenie (stack už
stiahnutý, len sa štartuje) je otázka desiatok sekúnd.

Skript je bezpečné spúšťať opakovane — na už pripravenom prostredí len
skontroluje, že všetko beží, a nič nezopakuje ani nepokazí.

## 3. Čo kde beží

| Čo | Adresa | Poznámka |
|---|---|---|
| Appka (Next.js) | http://localhost:3000 | `npm run dev`, spúšťaš zvlášť |
| Supabase API | http://127.0.0.1:54321 | Auth, PostgREST — appka naň pripája cez `NEXT_PUBLIC_SUPABASE_URL` |
| Postgres | postgresql://postgres:postgres@127.0.0.1:54322/postgres | rola `postgres`, heslo `postgres` — bezpečné len preto, že port počúva len na localhoste |
| Supabase Studio | http://127.0.0.1:54323 | prehliadanie/úprava dát cez webové UI, bez SQL klienta |
| Mailpit | http://127.0.0.1:54324 | lokálny SMTP catcher (v starších verziách Supabase CLI pod menom "Inbucket") — pozri sekciu 4 nižšie, prečo ho appka v bežnom vývoji nevyužije |

## 4. Prihlásenie

`npm run dev:bootstrap` na konci vypíše prihlasovacie údaje. Demo
organizácia má 5 kont (heslo je pre všetky rovnaké, tiež vypísané na
konci behu):

| Rola | Email |
|---|---|
| Majiteľ | `owner@dev.local` |
| Manažér — Hotel (s pridelenými pravomocami) | `manager.hotel@dev.local` |
| Manažér — Office | `manager.office@dev.local` |
| Zamestnanec — Hotel, Recepcia | `employee.hotel@dev.local` |
| Zamestnanec — Office, Účtovník | `employee.office@dev.local` |

**Ako sa vyzdvihne email-OTP kód pri prihlásení ownera (2FA):** appka
NEODOSIELA maily naozaj, kým nie je nastavená `RESEND_API_KEY` (v
`.env.development.example` je zámerne prázdna) — namiesto toho `sendEmail`
(`lib/email/resend.ts`) vypíše celý obsah mailu (predmet aj telo, teda aj
kód) priamo do **terminálu, kde beží `npm run dev`**, pod hlavičkou
`[email:stub]`. Toto **nie je** to isté ako Mailpit vyššie — appka posiela
maily vlastnou cestou cez Resend, nie cez Supabase Auth natívne, takže sa
do Mailpitu nedostanú. Rovnako fungujú aj pozývacie a reset-hesla odkazy.

**Alternatíva, ak ti 2FA prekáža pri nesúvisiacej práci:** odkomentuj
`DEV_DISABLE_2FA=true` v `.env.local` (šablóna ho má pripravený,
zakomentovaný). Predvolene je vypnuté ZÁMERNE — bežný lokálny vývoj má
overovať SKUTOČNÝ tok, akým appka beží aj v produkcii, nie skratku okolo
neho. Tvrdo ignorované, keď `NODE_ENV=production`.

## 5. Bežné úkony

- **Čistý reštart** (zahodí databázu, založí ju nanovo): `npm run
  dev:bootstrap -- --reset` — vyžiada si potvrdenie, je to nezvratné.
- **Zastavenie stacku:** `npm run dev:stop`
- **Stav stacku:** `npm run dev:status`
- **Nová migrácia:** `npm run db:generate` (Drizzle vygeneruje SQL zo
  zmien v `lib/db/schema.ts`), potom `npm run db:migrate` na jej
  aplikovanie proti bežiacemu lokálnemu stacku.
- **Testy:** `npm run test:unit` (nepotrebuje databázu) a `npm run
  test:db` (potrebuje bežiaci lokálny stack — `npm run dev:bootstrap`
  najprv). Proti plnému stacku prejdú VŠETKÝCH 48 `*.db.test.ts` súborov
  (9 z nich v CI bežať nemôže — potrebujú Supabase Auth, nielen Postgres,
  pozri `CONTRIBUTING.md`).
- **Screenshoty** (nápoveda aj README) sa negenerujú ručne — `npm run
  screenshots` proti tomuto stacku. Návod je v
  [`docs/SCREENSHOTS.md`](SCREENSHOTS.md).

## 6. Vzťah dvoch migračných systémov — **prečítaj si toto pred prvou zmenou schémy**

Tento projekt používa **výhradne Drizzle** na správu databázovej schémy
(`lib/db/migrations/`, `npm run db:migrate`). Supabase CLI má VLASTNÝ,
úplne nezávislý migračný systém (`supabase/migrations/`,
`supabase db push/pull/migration`) — ten sa v tomto projekte **nepoužíva
vôbec**. Lokálny Supabase stack (`npx supabase start`) slúži VÝHRADNE na
spustenie služieb (Postgres, Auth, Studio, Mailpit) — schému doňho
dostaneš rovnako ako pri produkčnom Supabase projekte, cez
`npm run db:migrate`.

Ak by sa tieto dva systémy zamiešali, vznikli by DVA rozchádzajúce sa
zdroje pravdy o schéme — presne to, čomu sa `docs/ARCHITECTURE.md`
(sekcia "Model bezpečnosti") aj `schema.sql` (generovaný, needituje sa
ručne) vyhýbajú. Preto:

**Nikdy nespúšťaj:**
- `supabase db reset` / `supabase db push` / `supabase db pull` /
  `supabase migration ...` — patria k Supabase-vlastnému migračnému
  systému, ktorý tu nepoužívame. Ak potrebuješ čistú databázu, použi
  `npm run dev:bootstrap -- --reset`.
- `supabase link` — naviazal by lokálny projekt na vzdialenú (cloudovú)
  inštanciu. Pracujeme výhradne lokálne, žiadny lokálny beh sa nemá kam
  "linkovať".

## 7. Riešenie problémov

**Port už je obsadený** (napr. 54321-54324, 3000). Skontroluj, či už
nebeží iný lokálny Supabase stack (aj z INÉHO projektu) — `npx supabase
status` (v koreni tohto repozitára) alebo `docker ps`. Dva rôzne
`supabase start` naraz na tom istom stroji kolidujú na rovnakých portoch.

**Docker Desktop nebeží.** `npm run dev:bootstrap` to skontroluje ako
prvý krok a zreteľne to nahlási — spusti Docker Desktop a skús znova.

**Stack sa nespustí / `npx supabase start` zamrzne alebo zlyhá.** Skús
`npm run dev:stop` a potom znova `npm run dev:bootstrap`. Ak to nepomôže,
`docker ps` ukáže, ktoré kontajnery reálne bežia — `docker logs
supabase_db_doch_dzka` (názov kontajnera obsahuje `project_id` z
`supabase/config.toml`) často ukáže konkrétnu príčinu.

**`app_user` nemá heslo / appka hlási zlyhané pripojenie do DB.**
`npm run dev:bootstrap` spúšťa `node scripts/setup-app-role-password.mjs`
automaticky, ale ak si migrácie spustil/a ručne mimo neho, spusti tento
krok zvlášť: `node --env-file=.env.local scripts/setup-app-role-password.mjs`
— bez `--env-file` skript nevidí `APP_DB_PASSWORD` z `.env.local` a zlyhá.
Bez tohto kroku appka nevie pripojiť pod rolou `app_user`
(`APP_DATABASE_URL`).

**Migrácie zlyhajú v polovici.** Drizzle aplikuje migrácie v poradí a
zapamätá si, ktoré už prešli (`__drizzle_migrations` v schéme `drizzle`)
— oprav príčinu a spusti `npm run db:migrate` znova, dokončí sa od
miesta zlyhania. Ak databáza skončila v stave, s ktorým sa nedá ďalej
pracovať, najjednoduchšie je `npm run dev:bootstrap -- --reset` a začať
odznova (lokálne demo dáta, nič sa tým nestratí).

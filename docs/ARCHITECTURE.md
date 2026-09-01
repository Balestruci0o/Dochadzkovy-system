# Architektúra — Dochádzkový systém

## 1. Stack

| Vrstva | Technológia | Prečo |
|---|---|---|
| Frontend + API | **Next.js 15** (App Router) na Verceli | React už vieš; API routes = Node.js backend v tom istom repe |
| Databáza | **Supabase** (PostgreSQL 15) | RLS izolácia prevádzok; malé nasadenie vystačí s voľným tierom |
| Auth | **Supabase Auth** | Pozvánky mailom (`admin.auth.admin.generateLink`), heslo + email-OTP 2FA pre ownera |
| ORM | **Drizzle** | Typovo bezpečné, parametrizované query → SQL injection prakticky nemožná |
| Súbory | **Supabase Storage** | Tabuľka `absence_attachments` (prílohy k PN-kám) v schéme existuje, ale appka ju zatiaľ nikde nečíta ani nezapisuje — nie je to hotová funkcia |
| Cron | **Vercel Cron** | Generovanie rozvrhu, auto-uzavretie razítok |
| Email | **Resend** | Pozvánky, notifikácie |
| PDF | **@react-pdf/renderer** | Server-side, bez headless browsera |
| Excel | **exceljs** | Výkaz pre účtovníčku |
| Terminál | **ESP32 + GM65 + OLED** | Nízkonákladový hardvér; server-side protokol (HMAC, JWT QR) je v tomto repozitári hotový a otestovaný, samotný firmvér (ESP32 sketch) v ňom zatiaľ nie je |

**Na malých nasadeniach vystačia free tiery** (Vercel Hobby, Supabase Free, Resend Free). Presný bod, odkedy treba platený tier, závisí od počtu zamestnancov a objemu dát konkrétnej organizácie — pozri aktuálny cenník daného poskytovateľa.

**Zdroj pravdy pre databázovú schému sú VÝHRADNE migrácie** v `lib/db/migrations/` (spúšťané cez `npm run db:migrate`) — `schema.sql` v koreni repozitára je **generovaný** čitateľný prehľad celej schémy vrátane RLS (`pg_dump --schema-only` proti čistej DB po migráciách, presný príkaz aj dátum poslednej regenerácie sú v jeho vlastnej hlavičke) a needituje sa ručne. Pri pridaní novej migrácie treba `schema.sql` znova vygenerovať — pri akomkoľvek rozpore (napr. ak to niekto zabudne) rozhodujú vždy migrácie.

---

## 2. Model bezpečnosti — dve vrstvy

Toto je najdôležitejšia časť. Bezpečnosť **nestojí na aplikačnom kóde.**

### Vrstva 1: Row Level Security (databáza)

Každé query beží pod identitou prihláseného používateľa. Postgres sám odfiltruje riadky, ku ktorým nemá prístup.

```
Manažér hotela spraví: SELECT * FROM employees
Postgres vráti:        len zamestnancov hotela
```

**Aj keby si v API zabudol na kontrolu**, dáta office sa k nemu nedostanú. Chyba v kóde nevedie k úniku dát.

Implementácia: pri každej požiadavke sa nastaví `SET LOCAL app.user_id = '<uuid>'` a RLS politiky (v `lib/db/migrations/`, jedinom záväznom zdroji — `schema.sql` je zastaraný prehľad) rozhodnú zvyšok.

**Dve DB roly, nie jedna:** Supabase rola `postgres` má `rolbypassrls = true` —
keby appka bežné queries púšťala pod ňou, RLS by sa nikdy nevyhodnotilo
(ticho by prešlo všetko). Appka preto pripája pod vlastnou rolou `app_user`
(`NOSUPERUSER NOBYPASSRLS`, `lib/db/index.ts`); `postgres` (`lib/db/admin.ts`,
premenná `adminDb`) zostáva len pre migrácie, seed a nižšie vymenované
výnimky. Overené aj testom, ktorý beží priamo pod Supabase built-in rolou
`authenticated` (nie len pod `app_user`) — Supabase totiž automaticky
udeľuje plný CRUD grant `anon`/`authenticated` na každej tabuľke, takže
jediné, čo tam čokoľvek chráni, je RLS samotné, nie granty.

### Vrstva 2: Aplikačná autorizácia

Bežné kontroly v API (`môže tento manažér schváliť túto žiadosť?`). Ale to je **druhá** obranná línia, nie prvá.

### Service role (`adminDb` / Supabase Auth admin API) — presný zoznam výnimiek

**Pravidlo:** service role len tam, kde sa RLS **fyzicky nedá použiť** — nie
tam, kde je to pohodlnejšie. Ide o dva odlišné mechanizmy:

- **`adminDb`** (`@/lib/db/admin`, Postgres rola `postgres`, `rolbypassrls`) —
  import mimo `lib/db/` a `lib/auth/` vyžaduje
  `// eslint-disable-next-line no-restricted-imports -- <dôvod>`; ESLint
  pravidlo (`eslint.config.mjs`, `RESTRICTED_DB_IMPORTS`) to naozaj vynucuje,
  build zlyhá bez neho.
- **`createSupabaseAdminClient()`** (`@/lib/supabase/admin`, Supabase Auth
  admin API — `admin.auth.admin.*`) — **ESLint toto pravidlo nevynucuje**,
  reštrikcia sa vzťahuje len na importy `db`/`adminDb`. Použitia nižšie
  (kategória D) sa spoliehajú výhradne na code review.

| # | Kde | Prečo RLS nestačí |
|---|---|---|
| A | `lib/auth/session.ts` (`getCurrentUser`), `prihlasenie`/`nastavit-heslo` akcie | Bootstrap identity — kým nepoznáme `users.id`, nemáme čo dať do `app.user_id` |
| B | `app/(app)/dnes/actions.ts`, `app/(app)/pipnutia/actions.ts` (manažérske opravy pípnutí), `app/api/punch/web/route.ts` (pípanie cez web, nie terminál), `lib/punch/attendance.ts` (zdieľaný prepočet dochádzky) | Zápis do `punch_events` ide vždy cez service role, bez ohľadu na to, či je volajúci prihlásený — nikdy priamo cez klientovu RLS session |
| D | `app/pozvat/actions.ts`, `app/(auth)/obnova-hesla/actions.ts` (`admin.auth.admin.generateLink`), `app/(app)/zamestnanci/[id]/actions.ts` (`admin.auth.admin.deleteUser`, čistenie Supabase Auth konta pri `confirmDeleteEmployeeAction`) | Supabase Auth admin API — úplne iná hranica ako Postgres RLS, niet neprivilegovanej alternatívy |
| — | `POST /api/punch`, `POST /api/punch/sync` | Terminál sa autentifikuje HMAC podpisom, nie Supabase session — žiadny `app.user_id` neexistuje |
| — | Cron joby (generátor rozvrhu, auto-uzavretie) | Bežia bez prihláseného používateľa |

Čo **nie je** legitímna výnimka: písanie do vlastného `users` riadku
(napr. `phone`, `activated_at`, `last_login_at`) ide cez `users_self_update`
RLS politiku (`withUserContext`), nie cez `adminDb` — pôvodne to tak nebolo
(politika bola príliš úzka), opravené v `lib/db/migrations/0005`.

### Proti SQL injection

Drizzle ORM generuje výhradne parametrizované query. Reťazce sa nikdy nelepia do SQL. Ak niekde treba raw SQL, ide cez `sql` template s parametrami — nie cez konkatenáciu.

### Ostatné

- **Heslá:** Supabase Auth (bcrypt), min. 12 znakov, kontrola proti známym únikom (HaveIBeenPwned API)
- **2FA:** jednorazový 6-miestny kód mailom (`email_otp_codes`, NIE TOTP),
  povinný **len** pre `owner` — pre ostatné role neexistuje ani ako voľba
  (`lib/auth/mfa.ts`).
- **Rate limiting:** DB-based (nie Upstash/Redis), samostatne pre login
  (`lib/auth/rate-limit.ts`, `login_events`, 5 pokusov/email a 20/IP za
  15 min), `/api/punch` (`lib/punch/rate-limit.ts`), overovanie email-OTP
  kódu (`lib/auth/email-otp-rate-limit.ts`) a potvrdzovanie deštruktívnych
  akcií (`lib/auth/destructive-action-rate-limit.ts`). Žiadosť o obnovu
  hesla (`obnova-hesla`) v súčasnom kóde rate limit **nemá** — pozri
  NALEZY.md.
- **Audit log:** DB trigger, nedá sa obísť z aplikácie
- **Razítka:** append-only, vynútené triggerom. Nedajú sa prepísať ani zmazať.

---

## 3. Pípanie — celý tok

**Rozsah tohto repozitára:** server-side protokol nižšie (JWT QR token,
HMAC overenie terminálu, offline sync, `/api/punch*`) je hotový a
otestovaný. Samotný **firmvér pre ESP32 terminál v tomto repozitári nie
je** — nasledujúci popis terminálu je špecifikácia protokolu, ktorý má
firmvér implementovať, nie odkaz na existujúci kód.

```
┌─────────────┐   ┌──────────────┐   ┌──────────────┐   ┌────────────┐
│   MOBIL     │   │   TERMINÁL   │   │    SERVER    │   │  DATABÁZA  │
│ (zamestnanec)│  │ ESP32 + GM65 │   │  Next.js API │   │  Postgres  │
└─────────────┘   └──────────────┘   └──────────────┘   └────────────┘
      │                   │                  │                 │
  1.  │ GET /api/qr-token │                  │                 │
      ├──────────────────────────────────────>                 │
      │                   │                  │  vytvor JWT     │
      │                   │                  │  (jti, 30 s)    │
      │                   │                  ├────────────────>│
      │  <── JWT ─────────────────────────────                 │
      │                   │                  │                 │
  2.  │ zobrazí QR        │                  │                 │
      │ (obnovuje sa      │                  │                 │
      │  každých 25 s)    │                  │                 │
      │                   │                  │                 │
  3.  │ ══ mávne pred skenerom ══>           │                 │
      │                   │ GM65 prečíta     │                 │
      │                   │ (~1 s)           │                 │
      │                   │                  │                 │
  4.  │                   │ POST /api/punch  │                 │
      │                   │ {token, device_id,                 │
      │                   │  hmac, timestamp}│                 │
      │                   ├─────────────────>│                 │
      │                   │                  │ overí:          │
      │                   │                  │  • HMAC podpis  │
      │                   │                  │  • JWT platnosť │
      │                   │                  │  • jti nepoužitý│
      │                   │                  │  • terminál aktívny
      │                   │                  ├────────────────>│
      │                   │                  │  zapíš punch    │
      │                   │  <── {meno, "in", "07:02"} ────────│
      │                   │                  │                 │
  5.  │                   │ displej:         │                 │
      │                   │ "Jano — príchod  │                 │
      │                   │  07:02 ✓"        │                 │
```

### Prečo je to bezpečné

**QR token je JWT s krátkou platnosťou (30 s).** Obsahuje `employee_id`, `jti` (unikátne ID) a `exp`.

- **Odfotenie QR nepomôže** — o 30 sekúnd je neplatný
- **Poslanie screenshotu kolegovi nepomôže** — kým ho ten dostane, vyprší
- **Replay útok nefunguje** — `jti` sa dá minúť len raz (tabuľka `qr_tokens`)
- **Terminál sa autentifikuje HMAC podpisom** so zdieľaným tajomstvom → cudzie zariadenie nemôže posielať razítka

**Aby Jano pípol za Petra**, potreboval by Petrov odomknutý telefón s Petrovým prihlásením. To už nie je „kamarát ma pípol", ale krádež identity.

### Offline režim

ESP32 má **frontu v NVS pamäti**:

1. Naskenuje token, skúsi odoslať
2. Ak nie je WiFi → uloží `{token, timestamp, hmac}` do fronty
3. Displej ukáže: „Zaznamenané (offline)"
4. Keď sa WiFi vráti, odošle celú frontu

Server rozpozná offline razítka (`is_offline_sync = true`) a použije `occurred_at` z terminálu, nie čas prijatia. Terminál musí mať **NTP synchronizovaný čas** — dopĺňa sa pri každom pripojení.

**Bezpečnostná poznámka:** offline razítka sa nedajú overiť proti `jti` v reálnom čase (server ich vidí až neskôr). Ochrana: token má aj timestamp a HMAC terminálu, takže sa nedá sfalšovať — len teoreticky prehrať dvakrát. Server pri sync-u kontroluje duplicity podľa `jti`.

### GPS — soft signál

Keď zamestnanec pípa cez web (napr. home office), mobil pošle GPS. Server vypočíta vzdialenosť od prevádzky.

- **V okruhu** → OK
- **Mimo okruhu** → razítko **prejde**, ale označí sa `gps_suspicious = true`

Manažér vidí zoznam podozrivých razítok. GPS sa dá podvrhnúť a v budove je nepresná — preto **nikdy neblokuje**, len upozorňuje.

Pri pípaní cez terminál sa GPS nerieši — fyzická prítomnosť pri skeneri je silnejší dôkaz.

---

## 4. Generátor rozvrhu

### Kedy beží

**Vercel Cron, 7 dní pred koncom mesiaca**, pre každú prevádzku zvlášť (ale v rovnaký deň). Manažér vie kedykoľvek spustiť **pregenerovanie** tlačidlom.

### Ako pracuje

Toto **nie je** jednoduchý cyklus cez dni. Je to **constraint satisfaction problem** — a keďže zadanie ešte nie je uzavreté, algoritmus musí byť riadený **dátami z DB**, nie zadrátovanou logikou.

```
1. NAČÍTAJ VSTUPY
   ├── zamestnanci prevádzky + ich šablóny zmien
   ├── pravidlá dostupnosti (employee_availability_rules) — s hard/soft flagmi
   ├── §ZP pravidlá (legal_rules)
   ├── požiadavky na pokrytie (coverage_requirements)
   ├── absencie (vrátane ešte neschválených)
   ├── zamknuté zmeny (locked = true → nedotýkaj sa)
   └── dni zatvorenia prevádzky (workplace_closures)

2. PRE KAŽDÝ DEŇ, PRE KAŽDÚ POŽADOVANÚ POZÍCIU:
   │
   ├── nájdi KANDIDÁTOV
   │     └── pre každého over VŠETKY pravidlá
   │           ├── HARD porušené → kandidát VYPADÁVA
   │           └── SOFT porušené → kandidát zostáva, ale s penalizáciou
   │
   ├── ak nie sú kandidáti → ZAPÍŠ DIERU (schedule_violations)
   │     └── s presným dôvodom: kto bol blízko a čo ho blokovalo
   │
   └── inak vyber kandidáta s NAJNIŽŠÍM SKÓRE
```

### Skórovanie (férovosť)

Pre každého kandidáta sa počíta penalizácia. Vyhráva najnižšia.

| Kritérium | Váha | Zdôvodnenie |
|---|---|---|
| Odchýlka od **zmluvného fondu** | 1000 | Kto má odrobené menej, dostane prednosť. Zmluvný fond je zmluvná povinnosť, nie odporúčanie. |
| Nerovnomernosť **víkendov** | 500 | Víkendy sú najnepopulárnejšie → musia byť rozdelené férovo. |
| Nerovnomernosť **hodín** | 300 | Vyrovnávanie nad rámec fondu. |
| Porušenie **soft** pravidla | 200 × priorita | Nie je zakázané, ale nechceme to. |
| **Sviatky** | 150 | Podobne ako víkendy. |
| **Mäkké párovanie** (bonus, znižuje skóre) | 100 × počet partnerov pracujúcich v ten deň | „Pekné, ak vyjde", nikdy povinnosť — nikdy sa nedostane nad hard pravidlá. |
| Odchýlka od **preferovanej zmeny** | 50 | Kozmetika. |

Skóre sa počíta **priebežne** — po každom priradení sa aktualizujú počty, takže sa hodiny a víkendy vyrovnávajú počas celého behu.

### Keď sa deň nedá obsadiť („chybové hlásenie musí byť presné")

Generátor **nerobí násilie**. Nechá dieru a zapíše presne, čo sa stalo:

```json
{
  "date": "2026-08-17",
  "severity": "gap",
  "rule_code": "COVERAGE",
  "message": "17. 8. — chýba obsadenie pozície Recepcia (potrebná 1, priradených 0)",
  "details": {
    "needed": 1,
    "assigned": 0,
    "candidates_rejected": [
      { "name": "Jana Nováková", "blocked_by": "MIN_REST_DAILY",
        "detail": "Predchádzajúca zmena končí 16. 8. o 22:00, odpočinok by bol 9 h (min. 12 h)" },
      { "name": "Andrej Kováč", "blocked_by": "BLOCK_LENGTH",
        "detail": "Má 5-dňové bloky, tento deň je mimo jeho bloku (hard pravidlo)" },
      { "name": "Peter Hric", "blocked_by": "ABSENCE",
        "detail": "Dovolenka 15.–20. 8." }
    ]
  }
}
```

Manažér presne vidí, koho by mohol prehovoriť a ktoré pravidlo by musel porušiť. **To je oveľa užitočnejšie ako „nepodarilo sa vygenerovať".**

### Ručný zásah

- Manažér **smie prepísať čokoľvek** — aj s porušením §ZP. Systém ho upozorní, ale nezablokuje.
- Ručne zadaná zmena dostane `locked = true` → **pregenerovanie sa jej nedotkne**
- Keď manažér pridá dovolenku doprostred mesiaca → **zmena vypadne, diera zostane**, rieši ju ručne (alebo klikne „pregenerovať")

---

## 5. Multi-tenant izolácia

```
                    ┌──────────────┐
                    │  MAJITEĽ     │  vidí všetko
                    └──────┬───────┘
             ┌─────────────┴─────────────┐
             ▼                           ▼
    ┌────────────────┐          ┌────────────────┐
    │ Manažér HOTEL  │          │ Manažér OFFICE │
    │ (manager_      │          │                │
    │  workplaces)   │          │                │
    └───────┬────────┘          └───────┬────────┘
            ▼                           ▼
    ┌────────────────┐          ┌────────────────┐
    │  Zamestnanci   │          │  Zamestnanci   │
    │     hotela     │          │    office      │
    └────────────────┘          └────────────────┘
```

Manažér **môže mať viac prevádzok** — preto `manager_workplaces` ako M:N tabuľka.
Zamestnanec **môže byť vo viacerých prevádzkach** — preto `employee_workplaces`, a v každej **inú sadzbu** (`employee_rate_history.workplace_id`).

Všetko sa vynucuje cez funkciu `accessible_workplaces()` v RLS politikách.

---

## 6. Nasadenie a demo dáta

Existuje jedno nasadenie na jednu organizáciu (jeden Supabase projekt, jedna
databáza) — appka nerozlišuje "produkčný" a "demo" režim za behu. Rozdiel je
v tom, **ako sa databáza naplní pred prvým použitím**:

- **`npm run setup`** (`scripts/setup.ts`) — skutočné nasadenie. Interaktívne
  (alebo skriptovane cez `--non-interactive` a CLI flagy pre CI) založí prvú
  organizáciu, prevádzku a majiteľa. Beží pod `adminDb`, lebo v tom momente
  ešte neexistuje žiadny prihlásený používateľ, pod ktorého identitou by
  bežali RLS politiky (rovnaký dôvod ako kategória A v sekcii 2).
- **`npm run db:seed`** (`lib/db/seed.ts`) — vývojársky nástroj na vymyslené,
  ale realistické demo dáta pre lokálny vývoj/testovanie. Má dve poistky:
  odmietne bežať s `NODE_ENV=production` a odmietne bežať nad databázou,
  kde už existuje organizácia (teda aj nad omylom pripojenou produkčnou DB
  so zle nastaveným `NODE_ENV`).

Reálne dáta nasadenej firmy a vymyslené seed dáta sa fyzicky nemôžu stretnúť
v tej istej databáze — `db:seed` na neprázdnej DB zlyhá.

---

## 7. Štruktúra projektu

```
dochadzka/
├── app/
│   ├── (auth)/                  login, nastavenie hesla
│   ├── auth/callback/           cieľ pozývacích/reset odkazov z `admin.auth.admin.generateLink`
│   ├── pozvat/                  pozvánka nového používateľa
│   ├── 2fa/                     email-OTP overenie (len owner)
│   ├── (app)/
│   │   ├── dnes/                dashboard
│   │   ├── kalendar/            rozvrh + generátor
│   │   ├── zamestnanci/         zoznam, detail, pravidlá
│   │   ├── pipnutia/            manažérske opravy pípnutí
│   │   ├── ziadosti/            schvaľovanie (manažér)
│   │   ├── moja-dochadzka/, moj-rozvrh/, moje-ziadosti/   vlastný pohľad zamestnanca — SÚ vnútri (app)/, nie samostatná route group
│   │   ├── vykazy/              PDF, Excel
│   │   ├── audit/                záznam auditného logu
│   │   └── nastavenia/          ← SAMOOBSLUHA (owner)
│   │       ├── prevadzky/
│   │       ├── pozicie/
│   │       ├── zmeny/           šablóny zmien
│   │       ├── pravidla/        §ZP + pokrytie, hard/soft
│   │       └── terminaly/
│   ├── punch/                   rotujúci QR (PWA)
│   └── api/
│       ├── qr-token/            vydá JWT pre mobil
│       ├── punch/               ← terminál sem posiela (HMAC auth)
│       ├── punch/sync/          offline dávka
│       ├── punch/web/           pípanie cez web (prihlásený zamestnanec, nie terminál)
│       ├── vykazy/              export výkazov
│       └── cron/
│           ├── generate-schedule/   generovanie rozvrhu
│           └── auto-close/          zabudnuté odchody
├── lib/
│   ├── db/                      Drizzle schéma + migrácie
│   ├── auth/                    session, RLS kontext, 2FA, rate limity
│   ├── punch/                   HMAC, QR token, spracovanie pípnutí, rate limit
│   ├── scheduler/               ← GENERÁTOR (jadro)
│   │   ├── rules.ts             vyhodnocovanie pravidiel
│   │   ├── scoring.ts           férovosť
│   │   └── generate.ts          hlavný algoritmus
│   ├── payroll/                 výpočet hodín, príplatkov
│   ├── reports/                 PDF (react-pdf), Excel (exceljs)
│   ├── branding/                konfigurovateľná značka (názov, logo, farby)
│   └── supabase/                Supabase Auth admin klient
├── scripts/
│   └── setup.ts                 inštalačný skript (`npm run setup`)
├── docs/                        táto architektúra, INSTALL, atď.
└── .github/workflows/           CI — lint, typecheck, testy
```

Firmvér pre ESP32 terminál **nie je súčasťou tohto repozitára** — pozri
poznámku v sekcii 3.

---

## 8. Čo je zámerne konfigurovateľné (a prečo)

Podmienky (§ZP limity, minimálne pokrytie, nárok na dovolenku, príplatky...)
sa pri nasadení môžu líšiť firmu od firmy, a nemusia byť vopred známe. Preto
**nič z toho nie je v kóde**:

| Vec | Kde je uložená | Kto ju mení |
|---|---|---|
| §ZP limity (12 h odpočinok, 40 h/týždeň) | `legal_rules` | owner, alebo manažér s granulárnym oprávnením `manageRules` |
| Minimálne pokrytie | `coverage_requirements` | owner, alebo manažér s `manageRules` |
| Typy zmien a ich časy | `shift_templates` | owner, alebo manažér s `managePositionsShifts` |
| Dostupnosť zamestnanca | `employee_availability_rules` | owner/manažér (bez ďalšieho oprávnenia) |
| Ktoré pravidlo sa smie porušiť | `is_hard` flag | rovnaké oprávnenie ako dané pravidlo (vyššie) |
| Prevádzky, sviatky | `workplaces`, `holidays` | len owner |
| Zatvorenia prevádzky | `workplace_closures` | owner, alebo manažér s `manageRules` |
| Nárok na dovolenku | `employees.vacation_days_per_year` | owner/manažér |

Granulárne oprávnenia manažéra (`manageRules`, `managePositionsShifts`,
`manageAccounts`, `manageTerminals`, `editWages`...) sú samostatný,
prideliteľný zoznam — pozri `lib/auth/manager-permissions.ts`. Bez
prideleného oprávnenia manažér danú vec meniť nesmie, ani keby mal
prístup k danej prevádzke.

**Keď sa o mesiac dozvieš, že chyžné majú 7,5 h a nie 8 — meníš riadok v DB, nie kód.**

---

## 9. Nemenné princípy architektúry

Deväť rozhodnutí, ktoré vysvetľujú, prečo je architektúra postavená presne
takto. Sú zámerné a opakovane potvrdené — odchýlka od ktoréhokoľvek z nich
by mala byť vedomé, zdokumentované rozhodnutie, nie skratka pri jednej
konkrétnej zmene.

### 1. Bezpečnosť je v databáze, nie v kóde

RLS (Row Level Security) je primárna obrana, nie aplikačná kontrola —
podrobne v sekcii 2. Manažér hotela nedostane riadky zamestnancov office
ani pri chybe v API kóde: Postgres sám odfiltruje, čo prihlásený
používateľ nesmie vidieť. Service role sa používa výhradne tam, kde to
sekcia 2 vyššie výslovne vymenúva — nikde inde.

### 2. Prístup k databáze ide výhradne cez server

RLS politiky čítajú `app.user_id`, ktoré nastavuje middleware appky
(`SET LOCAL app.user_id`), nie Supabase `auth.uid()` — appka nepoužíva
Supabase Auth JWT session cez PostgREST. Supabase klient v prehliadači
preto nemá odkiaľ zobrať identitu, pod ktorou by RLS niečo videlo; prístup
k dátam ide vždy cez Server Component, Server Action alebo API route. Ak
sa `app.user_id` nenastaví, RLS nevráti nič (fail-safe, nie fail-open) —
overené aj testami priamo pod skutočnou Supabase rolou `authenticated`,
nielen pod appkovou rolou `app_user`.

### 3. Razítka sú append-only (s jednou úzkou, vedomou výnimkou)

`punch_events` sa needituje nikdy — oprava chybného pípnutia je vždy nová
udalosť s `corrects_event_id`, nikdy prepis. Toto je to, čo obstojí pri
kontrole z inšpektorátu práce. UPDATE sa nedá obísť nikdy, bez výnimky.

Pôvodne rovnaké platilo aj pre DELETE. Zámerná, vedomá výnimka:
`punch_events` sa dá zmazať výhradne ako súčasť potvrdeného zmazania
CELÉHO zamestnanca (`confirmDeleteEmployeeAction` v
`app/(app)/zamestnanci/[id]/actions.ts`) — nikdy jednotlivo, nikdy priamo.
Mazanie je zamknuté na dvoch nezávislých vrstvách naraz: DB trigger
`punch_events_immutable()` aj samostatná RLS politika
`punch_events_delete_confirmed`, obe nezávisle vyžadujú rovnakú podmienku
(`current_setting('app.confirmed_employee_delete_id')`). Zapnúť to smie
len owner, po overení e-mailového potvrdzovacieho kódu, v rámci jednej
transakcie, pre jedného konkrétneho zamestnanca — každé použitie zanecháva
trvalý audit záznam. Dôsledky pre dôkaznú hodnotu a GDPR sú vedomé; každé
nasadenie by ich malo posúdiť s vlastným právnym poradcom.

### 4. Pravidlá sú dáta, nie kód

Prevádzkovateľ (firma, ktorá appku nasadzuje) môže mať vlastné pravidlá —
minimálne pokrytie, nárok na dovolenku, príplatky — ktoré appka vopred
nepozná. Preto nič z toho nie je zadrôtované v kóde: §ZP limity sú riadky
v `legal_rules`, minimálne pokrytie v `coverage_requirements`, typy zmien
v `shift_templates` (plný prehľad v sekcii 8). Keď sa pravidlo o mesiac
zmení, mení sa riadok v databáze, nie kód.

### 5. Zamestnanec je konfigurovateľná entita

Neexistuje „typický zamestnanec". Každý má vlastné pracovné časy
(`employee_shift_templates` s možnosťou override), pravidlá dostupnosti
(`employee_availability_rules`), zmluvný fond hodín a históriu pozícií a
sadzieb. „Andrej môže len 5-dňové bloky", „Eva len ranné okrem nedele" —
to všetko sú riadky v `employee_availability_rules`, nie špeciálne
prípady v kóde generátora.

### 6. Každé pravidlo má hard/soft flag

`is_hard = true` — generátor rozvrhu ho nikdy neporuší, radšej nechá dieru
v pokrytí. `is_hard = false` — generátor ho poruší, ak niet inej
možnosti, ale porušenie vždy nahlási. Platí rovnako pre pravidlá
dostupnosti, pokrytia aj §ZP.

### 7. Generátor nerobí násilie

Keď sa deň nedá obsadiť legálne, generátor nechá dieru a do
`schedule_violations` zapíše presne, čo chýba a kto bol kandidát a čo ho
blokovalo — napríklad „chýba Recepcia (potrebná 1, priradených 0); Jana
blokuje MIN_REST_DAILY; Andrej mimo 5-dňového bloku; Peter má dovolenku",
nie len „nepodarilo sa vygenerovať rozvrh". Generátor nikdy nezvolí
„najmenšie zlo" tichým porušením pravidla.

### 8. História sa nestráca

Pozície a sadzby sa menia v čase. Výkaz z marca musí použiť marcovú
sadzbu, nie dnešnú — preto `employee_rate_history` a
`employee_position_history` s `valid_from`/`valid_to`, nikdy len aktuálna
hodnota na riadku zamestnanca.

### 9. Audit log sa nedá obísť

Zapisuje ho DB trigger, nie aplikačný kód — nedá sa vynechať zabudnutím
na jednom mieste appky, keďže appka ho vôbec nezapisuje sama.

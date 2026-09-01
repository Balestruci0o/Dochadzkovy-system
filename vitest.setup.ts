import { config } from "dotenv";
import { expect, vi } from "vitest";

config({ path: ".env.local" });

/**
 * Fáza L, balík L6 — nález proti PLNÉMU lokálnemu Supabase stacku (prvýkrát
 * spustená celá `test:db` sada naraz). `lib/email/resend.ts` (`sendEmail`)
 * vetví na "žiadny kľúč → len log" ešte PRED tým, než sa vôbec dotkne
 * balíka `resend` (mockovaného nižšie) — takže `lib/notifications/
 * dispatch.db.test.ts` (vlastný lokálny mock `resend`, overuje OBSAH
 * odoslaného mailu) potrebuje `RESEND_API_KEY` nastavenú na HOCIJAKÚ
 * hodnotu, nie prázdnu. `.env.local` pre lokálny vývoj (Fáza L, L2) ju
 * ZÁMERNE necháva prázdnu (`npm run dev` má maily vypisovať do konzoly,
 * nie sa pokúšať reálne odoslať s falošným kľúčom) — a to isté chýba aj v
 * CI (`.github/workflows/ci.yml`, `db` job). Namiesto menenia `.env.local`
 * (čo by pokazilo `npm run dev`) alebo CI env (mimo rozsahu tohto súboru)
 * nastavíme placeholder VÝHRADNE pre beh testov, len ak už nie je nastavená
 * — `resend` balík je aj tak vždy mockovaný (nižšie, alebo lokálne v
 * dispatch.db.test.ts), takže sa touto hodnotou nikdy naozaj nič neodošle.
 */
if (!process.env.RESEND_API_KEY) {
  process.env.RESEND_API_KEY = "test-placeholder-key-resend-always-mocked";
}

/**
 * Poistka proti tichému driftu medzi `test:unit` a `test:db` — testy, ktoré
 * NIE SÚ `*.db.test.ts`/`*.db.test.tsx`, sa nesmú pokúsiť otvoriť reálne DB
 * spojenie. `lib/db/admin.ts` aj `lib/db/index.ts` volajú `postgres(...)`
 * (balík "postgres") PRI IMPORTE modulu (top-level `const client =
 * postgres(...)`) — to je presne moment "otvorenia spojenia", nie prvý
 * dopyt. Mockujeme preto balík "postgres" tak, aby v "necudnom" súbore
 * hodil rovno zrozumiteľnú chybu namiesto toho, aby zlyhanie vyzeralo ako
 * obyčajný pád testu na chýbajúcu/nedostupnú DB.
 *
 * `expect.getState().testPath` je tu (na najvyššej úrovni setup súboru,
 * PRED importom samotného testovacieho súboru) už vyplnené — overené
 * priamo, je to súčasť verejného `expect.getState()` API, nie interná
 * vec, na ktorú by sme sa nemali spoliehať.
 */
const currentTestPath = expect.getState().testPath ?? "";
const testAllowsDb = /\.db\.test\.tsx?$/.test(currentTestPath);

// `vi.mock` MUSÍ byť na najvyššej úrovni modulu (nie v `if`) — Vitest ho
// staticky vyhľadáva a hoistuje pred všetky importy; podmienené volanie by
// v budúcich verziách prestalo fungovať. Podmienka je preto AŽ vnútri
// factory funkcie.
vi.mock("postgres", async (importOriginal) => {
  const actual = await importOriginal<typeof import("postgres")>();
  if (testAllowsDb) return actual;
  const guarded = () => {
    throw new Error(
      `Tento test (${currentTestPath}) sa pokúša otvoriť DB spojenie (balík "postgres"), ale jeho názov nekončí na ".db.test.ts" — ak naozaj potrebuje živú databázu, premenuj ho na "*.db.test.ts" (git mv). Ak nie, over si, prečo sa v ňom DB spojenie vôbec otvára (napr. transitívny import lib/db/admin alebo lib/db/index).`,
    );
  };
  return { ...actual, default: guarded };
});

/**
 * Blok 11 — RESEND_API_KEY je v `.env.local` REÁLNY kľúč (potrebný pre
 * manuálne/produkčné odosielanie) — testy preto BEŽIA s API kľúčom
 * nastaveným a bez tohto mocku by `sendEmail()` (lib/email/resend.ts)
 * naozaj odoslal cez Resend na vymyslené testovacie adresy (`*-test.local`)
 * pri KAŽDOM spustení testovacej série. To by zbytočne míňalo reálnu
 * kvótu/reputáciu domény za dáta, čo nikto nikdy neprečíta — mockuje sa
 * preto LEN samotný `resend` balík (externá platená služba), nie naša
 * vlastná logika v `sendEmail()` (tá beží nezmenená, vrátane vetvy "žiadny
 * kľúč → log" aj reálnej vetvy, len sieťové volanie sa nikdy neodošle).
 */
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async () => ({ data: { id: "test-mock" }, error: null }) };
  },
}));

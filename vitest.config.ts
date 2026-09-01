import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // Blok 12 (PDF, .tsx moduly v lib/reports/pdf) — tsconfig.json má zámerne
  // `"jsx": "preserve"` (Next.js si JSX transformuje sám cez SWC) — Vitest/Vite
  // ale "preserve" nerozumie ("make sure to not set jsx to preserve"), takže
  // potrebuje vlastné, explicitné esbuild nastavenie nezávislé od tsconfig.
  oxc: {
    jsx: { runtime: "automatic" },
  },
  test: {
    env: {
      NODE_ENV: "test",
    },
    setupFiles: ["./vitest.setup.ts"],
    // Testy proti reálnej (vzdialenej) Supabase DB majú
    // tesnú rezervu voči nízkym timeoutom (jednoduchý round-trip vie trvať
    // 400ms+ len na latenciu, viacero round-tripov v jednom teste sa ľahko
    // priblíži k 5-15s). Pôvodne zdvihnuté z 5s na 15s; pri retestovaní
    // (39 súborov, sekvenčne, opakovane) aj 15s ešte vypršalo na testoch s
    // VEĽA round-tripov (celý POST /api/punch reťazec 2×, celé mesačné
    // generovanie rozvrhu cez cron) — nie na tých istých zakaždým, čo
    // potvrdzuje reálnu premenlivú sieťovú latenciu, nie zaseknutý kód.
    // Zdvihnuté na 30s ako NOVÝ globálny základ (namiesto donekonečna
    // pridávať vlastný override na každý ďalší test, čo na to narazí).
    // Skutočne zaseknutý/nekonečný beh aj tak 30s odhalí.
    testTimeout: 30_000,
    // `beforeAll`/`afterAll` robia REÁLNE DB inserty (org/employees/terminál)
    // presne tak ako testy samotné — musí mať rovnaký základ ako testTimeout,
    // inak hook vyprší skôr, než by vypršal ekvivalentný test.
    hookTimeout: 30_000,
    // Supavisor session-mode pooler má TVRDÝ strop
    // 15 klientov CELKOVO. Každý test súbor beží v samostatnom procese/vlákne
    // a KAŽDÝ modul (lib/db/admin.ts AJ lib/db/index.ts) si otvorí VLASTNÉHO
    // postgres.js klienta — pri paralelnom behu (Vitest default) sa niekoľko
    // desiatok súborov ľahko priblíži alebo prekročí 15 súčasných spojení
    // (EMAXCONNSESSION), čo sa navonok javilo ako náhodná "flaky" chyba v
    // hocijakom teste (vrátane timeoutov v ináč správnom kóde). Vypnutie
    // paralelizmu súborov nie je len rýchlejšie ladenie — je to OPRAVA
    // skutočnej príčiny opakovaných falošných zlyhaní, nie obchádzka.
    fileParallelism: false,
  },
});

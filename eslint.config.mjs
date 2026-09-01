import { FlatCompat } from "@eslint/eslintrc";
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import { defineConfig, globalIgnores } from "eslint/config";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const RESTRICTED_DB_IMPORTS = {
  paths: [
    {
      name: "@/lib/db",
      importNames: ["db"],
      message:
        "Priamy import `db` mimo lib/db/ a lib/auth/ obchádza kontrolu app.user_id. Použi withCurrentUser()/withUserContext() z lib/auth/session.ts. Ak vieš, že toto použitie je správne, priprav si zdôvodnenie a potlač pravidlo cez `// eslint-disable-next-line no-restricted-imports -- <dôvod>` (viď docs/ARCHITECTURE.md, sekcia 'Service role').",
    },
    {
      name: "@/lib/db/admin",
      importNames: ["adminDb"],
      message:
        "Priamy import `adminDb` OBCHÁDZA RLS (rola postgres, rolbypassrls=true). Mimo lib/db/ a lib/auth/ je to povolené len pre zdokumentované výnimky z docs/ARCHITECTURE.md (bootstrap identity, pred-auth operácie, Supabase Auth admin API). Ak je toto jedna z nich, potlač pravidlo cez `// eslint-disable-next-line no-restricted-imports -- <dôvod>`.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Každé odchýlenie od bezpečnej cesty (withCurrentUser/withUserContext)
    // musí byť viditeľné pri review ako `eslint-disable` riadok s dôvodom —
    // nie skryté v obyčajnom importe.
    plugins: {
      "eslint-comments": eslintComments,
    },
    rules: {
      "eslint-comments/require-description": ["error", { ignore: [] }],
    },
  },
  {
    // Mimo lib/db/ a lib/auth/ (kde tieto kluby žijú a sú preverené) je priamy
    // import `db`/`adminDb` zakázaný.
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["lib/db/**", "lib/auth/**"],
    rules: {
      "no-restricted-imports": ["error", RESTRICTED_DB_IMPORTS],
    },
  },
]);

export default eslintConfig;

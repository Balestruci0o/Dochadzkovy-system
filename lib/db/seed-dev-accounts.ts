import "dotenv/config";
import { ensureDevAccounts } from "./dev-accounts";

/**
 * ⚠️ LEN PRE DEV — pozri lib/db/dev-accounts.ts. Spusti cez `npm run db:seed:accounts`.
 * Vyžaduje DEV_ACCOUNTS_PASSWORD v .env.local (nikdy sa nesmie dostať do produkcie).
 */
ensureDevAccounts()
  .then((results) => {
    console.log("Dev kontá pripravené:");
    results.forEach((r) => console.log(`  ${r.label}: ${r.email}`));
    console.log(`\nHeslo: ${process.env.DEV_ACCOUNTS_PASSWORD}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Zlyhalo:", err.message);
    process.exit(1);
  });

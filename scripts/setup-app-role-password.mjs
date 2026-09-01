import postgres from "postgres";

const password = process.env.APP_DB_PASSWORD;
if (!password) {
  console.error("APP_DB_PASSWORD nie je nastavená");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
await sql.unsafe(`ALTER ROLE app_user WITH PASSWORD '${password.replace(/'/g, "''")}'`);
console.log("OK: heslo pre app_user nastavené");
await sql.end();

import "dotenv/config";
import { adminDb } from "./admin";
import { ensureDevAccounts } from "./dev-accounts";
import { legalRulesDefaults } from "./legal-rules-defaults";
import { seedScheduleAndAttendance } from "./seed-schedule";
import { SEED_ORG } from "./seed-org";
import {
  employeeRateHistory,
  employees,
  employeeWorkplaces,
  legalRules,
  managerWorkplaces,
  organizations,
  positions,
  users,
  workplaces,
} from "./schema";

/**
 * Dev seed — 1 organizácia, 2 prevádzky (Hotel, Office), pozície, zamestnanci
 * a §ZP pravidlá (viď schema.sql, sekcia 11). Beží pod admin klientom
 * (rolbypassrls), lebo v tomto bode ešte neexistuje prihlásený užívateľ,
 * pod ktorého identitou by mohli bežať RLS politiky.
 *
 * `db:seed` = demo dáta na vyskúšanie appky (fiktívna organizácia,
 * fiktívni ľudia). `npm run setup` (scripts/setup.ts) = skutočné nasadenie
 * pre reálnu firmu — interaktívne, s vlastným menom organizácie a majiteľom.
 * Nikdy nepoužívaj tento seed na nasadenie pre skutočnú firmu.
 *
 * Emaily (`@dev.local`) sú zámerne fiktívne — toto sú vymyslené dev dáta,
 * nie reálni ľudia. Ak je nastavená DEV_ACCOUNTS_PASSWORD, na konci sa navyše
 * založia funkčné prihlasovacie kontá (pozri lib/db/dev-accounts.ts) — inak
 * sa tento krok len preskočí.
 */
async function seed() {
  // Poistka 1 — demo seed sa do produkcie nesmie dostať vôbec, bez ohľadu na
  // to, či by "náhodou" bola prázdna DB.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "db:seed sa nesmie spustiť s NODE_ENV=production. Toto je dev nástroj na demo dáta — " +
        'na skutočné nasadenie použi "npm run setup".',
    );
  }

  // Poistka 2 — demo seed sa nesmie spustiť nad DB, kde už niekto reálny
  // pracuje (napr. omylom spustený seed proti produkčnej DB so správne
  // nastaveným NODE_ENV=development pri lokálnom pripojení na diaľku).
  const [existingOrg] = await adminDb.select({ name: organizations.name }).from(organizations).limit(1);
  if (existingOrg) {
    throw new Error(
      `V databáze už existuje organizácia "${existingOrg.name}". db:seed zakladá demo dáta a odmieta sa ` +
        'spustiť, ak DB nie je prázdna — na skutočné nasadenie použi "npm run setup".',
    );
  }

  const [org] = await adminDb
    .insert(organizations)
    .values({ name: SEED_ORG.name, ico: SEED_ORG.ico })
    .returning();

  const [hotel, office] = await adminDb
    .insert(workplaces)
    .values([
      {
        orgId: org.id,
        name: "Hotel",
        code: "HOTEL",
        operatingDays: [1, 2, 3, 4, 5, 6, 7],
        gpsLat: "48.1486000",
        gpsLng: "17.1077000",
      },
      {
        orgId: org.id,
        name: "Office",
        code: "OFFICE",
        operatingDays: [1, 2, 3, 4, 5],
      },
    ])
    .returning();

  const [recepcia, chyzna, ucotvnik] = await adminDb
    .insert(positions)
    .values([
      // requiresShiftLeader — Fáza L, balík L4: presne pre screenshot
      // "veduci-zmeny-priradenie" (nápoveda, téma rozvrh).
      { orgId: org.id, workplaceId: hotel.id, name: "Recepcia", color: "#7E9082", requiresShiftLeader: true },
      { orgId: org.id, workplaceId: hotel.id, name: "Chyžná", color: "#CF982A" },
      { orgId: org.id, workplaceId: office.id, name: "Účtovník", color: "#E0700F" },
    ])
    .returning();

  const [ownerUser, managerHotelUser, managerOfficeUser, employeeHotelUser, employeeOfficeUser, employeeHotel2User, employeeHotel3User] =
    await adminDb
      .insert(users)
      .values([
        {
          orgId: org.id,
          email: "owner@dev.local",
          role: "owner",
          fullName: "Martin Majiteľ",
        },
        {
          orgId: org.id,
          email: "manager.hotel@dev.local",
          role: "manager",
          fullName: "Hana Hotelová",
        },
        {
          orgId: org.id,
          email: "manager.office@dev.local",
          role: "manager",
          fullName: "Oto Officer",
        },
        {
          orgId: org.id,
          email: "employee.hotel@dev.local",
          role: "employee",
          fullName: "Jana Nováková",
        },
        {
          orgId: org.id,
          email: "employee.office@dev.local",
          role: "employee",
          fullName: "Peter Účtovník",
        },
        // Fáza L, balík L4 — druhá Recepčná a Chyžná, nech je "niekoľko
        // zamestnancov na rôznych pozíciách" naozaj pravda, nielen jeden na
        // pozíciu, a nech má generátor rozvrhu koho striedať.
        {
          orgId: org.id,
          email: "employee.hotel2@dev.local",
          role: "employee",
          fullName: "Zuzana Baranová",
        },
        {
          orgId: org.id,
          email: "employee.hotel3@dev.local",
          role: "employee",
          fullName: "Katarína Sokolová",
        },
      ])
      .returning();

  await adminDb.insert(managerWorkplaces).values([
    { userId: managerHotelUser.id, workplaceId: hotel.id },
    { userId: managerOfficeUser.id, workplaceId: office.id },
  ]);

  const [janaEmployee, peterEmployee, zuzanaEmployee, katarinaEmployee] = await adminDb
    .insert(employees)
    .values([
      {
        orgId: org.id,
        userId: employeeHotelUser.id,
        firstName: "Jana",
        lastName: "Nováková",
        hiredOn: "2024-01-15",
        contractHoursPerMonth: "173.93",
        contractType: "plny",
        // Fáza L, balík L4 — presne pre screenshot "moja-dochadzka-tlacidlo"
        // (tlačidlo na pípnutie z webu sa bez tohto vôbec nezobrazí, default
        // je vypnuté).
        canPunchWeb: true,
        // Fáza S (doriešenie, kolo 3) — Jana AJ Zuzana spôsobilé viesť zmenu,
        // nech generátor nemá NIJAKÝ deň bez oprávneného kandidáta na
        // Recepcii (lib/scheduler/shift-leader.ts, `eligible.length === 0`
        // → violation zapísaná do schedule_violations PRI GENEROVANÍ,
        // needitovateľná neskôr). `veduci-zmeny-priradenie` (nápoveda) si
        // Janinu spôsobilosť dočasne vypína a späť zapína priamo v
        // scripts/screenshots/prepare.ts — live DB kontrola pri kliknutí
        // (`assignShiftLeaderAction`), NEČÍTA sa z tejto uloženej snímky.
        canBeShiftLeader: true,
      },
      {
        orgId: org.id,
        userId: employeeOfficeUser.id,
        firstName: "Peter",
        lastName: "Účtovník",
        hiredOn: "2023-06-01",
        contractHoursPerMonth: "173.93",
        contractType: "plny",
      },
      // Fáza L, balík L4 — canBeShiftLeader: true, presne pre screenshot
      // "veduci-zmeny-priradenie" (Jana ho nemá, Zuzana áno).
      {
        orgId: org.id,
        userId: employeeHotel2User.id,
        firstName: "Zuzana",
        lastName: "Baranová",
        hiredOn: "2025-03-01",
        contractHoursPerMonth: "173.93",
        contractType: "plny",
        canBeShiftLeader: true,
      },
      {
        orgId: org.id,
        userId: employeeHotel3User.id,
        firstName: "Katarína",
        lastName: "Sokolová",
        hiredOn: "2025-06-01",
        contractHoursPerMonth: "120.00",
        contractType: "skrateny",
      },
    ])
    .returning();

  await adminDb.insert(employeeWorkplaces).values([
    { employeeId: janaEmployee.id, workplaceId: hotel.id },
    { employeeId: peterEmployee.id, workplaceId: office.id },
    { employeeId: zuzanaEmployee.id, workplaceId: hotel.id },
    { employeeId: katarinaEmployee.id, workplaceId: hotel.id },
  ]);

  await adminDb.insert(employeeRateHistory).values([
    {
      employeeId: janaEmployee.id,
      workplaceId: hotel.id,
      hourlyRate: "6.5000",
      validFrom: "2024-01-15",
    },
    {
      employeeId: peterEmployee.id,
      workplaceId: office.id,
      hourlyRate: "9.0000",
      validFrom: "2023-06-01",
    },
    {
      employeeId: zuzanaEmployee.id,
      workplaceId: hotel.id,
      hourlyRate: "6.8000",
      validFrom: "2025-03-01",
    },
    {
      employeeId: katarinaEmployee.id,
      workplaceId: hotel.id,
      hourlyRate: "6.0000",
      validFrom: "2025-06-01",
    },
  ]);

  // §ZP pravidlá — zdieľané defaulty, viď lib/db/legal-rules-defaults.ts
  await adminDb.insert(legalRules).values(legalRulesDefaults(org.id));

  // Fáza L, balík L4 — šablóny zmien, pokrytie, história pozícií, pravomoci
  // manažéra, vygenerovaný+zverejnený rozvrh tohto mesiaca, návrh budúceho
  // mesiaca, pípnutia (vrátane meškania a chýbajúceho odpípania) a žiadosti
  // o neprítomnosť vo všetkých troch stavoch — presne dáta, ktoré potrebujú
  // screenshoty nápovede (public/help/screenshots/README.md).
  await seedScheduleAndAttendance({
    hotelId: hotel.id,
    officeId: office.id,
    recepciaId: recepcia.id,
    chyznaId: chyzna.id,
    ucotvnikId: ucotvnik.id,
    ownerUserId: ownerUser.id,
    managerHotelUserId: managerHotelUser.id,
    janaId: janaEmployee.id,
    peterId: peterEmployee.id,
    zuzanaId: zuzanaEmployee.id,
    katarinaId: katarinaEmployee.id,
  });

  console.log("Seed hotový:");
  console.log({
    org: org.id,
    hotel: hotel.id,
    office: office.id,
    positions: { recepcia: recepcia.id, chyzna: chyzna.id, ucotvnik: ucotvnik.id },
    users: {
      owner: ownerUser.id,
      managerHotel: managerHotelUser.id,
      managerOffice: managerOfficeUser.id,
      employeeHotel: employeeHotelUser.id,
      employeeOffice: employeeOfficeUser.id,
      employeeHotel2: employeeHotel2User.id,
      employeeHotel3: employeeHotel3User.id,
    },
    employees: { jana: janaEmployee.id, peter: peterEmployee.id, zuzana: zuzanaEmployee.id, katarina: katarinaEmployee.id },
  });

  if (process.env.DEV_ACCOUNTS_PASSWORD) {
    const accounts = await ensureDevAccounts();
    console.log("\nDev prihlasovacie kontá pripravené (LEN PRE DEV):");
    accounts.forEach((a) => console.log(`  ${a.label}: ${a.email}`));
    console.log(`  heslo: ${process.env.DEV_ACCOUNTS_PASSWORD}`);
  } else {
    console.log(
      '\nDEV_ACCOUNTS_PASSWORD nie je nastavená — vynechávam vytvorenie prihlasovacích kont. ' +
        'Spusti "npm run db:seed:accounts", ak ich chceš.',
    );
  }

  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed zlyhal:", err);
  process.exit(1);
});

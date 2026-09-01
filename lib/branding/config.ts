/**
 * Jediný zdroj pravdy pre značku nasadenia (názov firmy, logo, texty).
 *
 * Prečo v env premenných, nie v tabuľke `organizations`: jedna inštalácia
 * appky = jedna firma. Značka je konfigurácia NASADENIA (rovnaká pre celý
 * beh appky, nastavuje sa raz pri deployi), nie dáta v databáze — vďaka
 * tomu ju vie prečítať aj klientský komponent (napr. `BrandLogo` v
 * sidebari) bez toho, aby čakal na DB dotaz alebo prenášal hodnotu cez
 * server component props.
 *
 * `NEXT_PUBLIC_*` premenné Next.js dosadzuje PRI BUILDE (nie za behu) —
 * po zmene hodnoty treba spustiť `npm run build` nanovo, reštart servera
 * nestačí.
 *
 * Premenné musia byť napísané DOSLOVA ako `process.env.NEXT_PUBLIC_BRAND_NAME`
 * atď. — Next.js nahrádza tieto výrazy staticky pri builde (string
 * replacement, nie skutočný beh `process.env` za behu), takže čítanie cez
 * dynamický kľúč (napr. `process.env[key]`) by za behu na klientovi vrátilo
 * `undefined`.
 */

export const brand = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Dochádzka",
  shortName: process.env.NEXT_PUBLIC_BRAND_SHORT_NAME || "Dochádzka",
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE || "",
  logoSrc: process.env.NEXT_PUBLIC_BRAND_LOGO || "/branding/logo.svg",
  appName: process.env.NEXT_PUBLIC_BRAND_APP_NAME || "Dochádzka",
};

export const brandMeta = {
  title: `${brand.name} — ${brand.appName}`,
  description: `Dochádzkový a rozvrhový systém pre ${brand.name}`,
  punchTitle: `Pípanie — ${brand.name}`,
  punchAppName: `${brand.shortName} Pípanie`,
};

export const brandServer = {
  name: brand.name,
  emailFrom: process.env.EMAIL_FROM || `${brand.name} <onboarding@resend.dev>`,
  emailFooter: `${brand.name} — dochádzkový systém`,
};

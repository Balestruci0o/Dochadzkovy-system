import type { UserRole } from "@/lib/auth/session";

/**
 * Pomocník — obsah je ZÁMERNE čistá dátová štruktúra (nie
 * JSX/komponenty), aby sa dala neskôr presunúť do DB a editovať priamo v
 * appke bez zmeny tvaru dát — pozri komentár nad `HELP_TOPICS` v content.ts.
 * Preto aj `icon` je len reťazcový kľúč (mapovanie na skutočnú ikonu je až
 * v komponente, nikdy tu).
 */

export type HelpIconKey = "clock" | "calendar" | "umbrella" | "file-text" | "settings" | "smartphone";

export type HelpStep = {
  text: string;
  /** Slug súboru v `public/help/screenshots/<slug>.png` — LEN pri kľúčových krokoch, nie pri každom. */
  screenshot?: string;
};

export type HelpArticle = {
  slug: string;
  title: string;
  /** Jedna veta — do zoznamu článkov a do vyhľadávania. */
  summary: string;
  /** Kto článok vidí. Zamestnanec nikdy nevidí manažérske/majiteľské články a naopak. */
  roles: UserRole[];
  steps: HelpStep[];
  /** Extra slová na vyhľadávanie (napr. "dovolenka", "PN" pre žiadosti), nad rámec title/summary. */
  keywords?: string[];
  /** Zatiaľ bez reálneho obsahu (klient ešte nepozná finálne pravidlá/UI danej sekcie). */
  placeholder?: boolean;
};

export type HelpTopic = {
  slug: string;
  label: string;
  icon: HelpIconKey;
  /** Téma sa zobrazí, len ak používateľova rola je v tomto zozname (aj keby mala 0 viditeľných článkov po filtri nižšie — v praxi sa to nestáva, ale je to tu ako dokumentácia zámeru). */
  roles: UserRole[];
  articles: HelpArticle[];
};

export type GlossaryTerm = {
  slug: string;
  term: string;
  explanation: string;
};

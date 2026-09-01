import type { HelpArticle, HelpTopic } from "./types";

export type HelpSearchHit = { topic: HelpTopic; article: HelpArticle };

const DIACRITICS_PATTERN = new RegExp("[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]", "g");

/** Bez diakritiky a v malých písmenách — nech "ako podat dovolenku" (bez mäkčeňov, bežné na mobile) nájde "Ako požiadať o dovolenku". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS_PATTERN, "").toLowerCase();
}

/**
 * Slovom-po-slove (nie presná fráza) — slovenčina má pády, takže dopyt a text
 * článku (iný pád toho istého slova) by sa pri hľadaní CELEJ frázy ako
 * súvislého reťazca vôbec nenašli. Nájde zhodu, ak sa KAŽDÉ slovo z dopytu
 * vyskytuje niekde v texte článku, bez ohľadu na poradie.
 */
export function searchHelpArticles(topics: HelpTopic[], query: string): HelpSearchHit[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: HelpSearchHit[] = [];
  for (const topic of topics) {
    for (const article of topic.articles) {
      const haystack = normalize([article.title, article.summary, ...(article.keywords ?? [])].join(" "));
      if (words.every((w) => haystack.includes(w))) hits.push({ topic, article });
    }
  }
  return hits;
}

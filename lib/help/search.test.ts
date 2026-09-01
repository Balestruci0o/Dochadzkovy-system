import { describe, expect, it } from "vitest";
import { normalize, searchHelpArticles } from "./search";
import { HELP_TOPICS } from "./content";
import type { HelpTopic } from "./types";

describe("normalize", () => {
  it("odstráni diakritiku a zmenší na malé písmená", () => {
    expect(normalize("Ako požiadať o dovolenku")).toBe("ako poziadat o dovolenku");
  });
});

describe("searchHelpArticles — reálny obsah pomocníka", () => {
  it("presne zadanie zo špecifikácie: 'ako podat dovolenku' nájde žiadosť o dovolenku", () => {
    const hits = searchHelpArticles(HELP_TOPICS, "ako podat dovolenku");
    expect(hits.some((h) => h.article.slug === "podanie-ziadosti")).toBe(true);
  });

  it("hľadanie bez diakritiky nájde to isté ako s diakritikou (bežné na mobilnej klávesnici)", () => {
    const withDiacritics = searchHelpArticles(HELP_TOPICS, "vedúci zmeny");
    const withoutDiacritics = searchHelpArticles(HELP_TOPICS, "veduci zmeny");
    expect(withoutDiacritics.map((h) => h.article.slug)).toEqual(withDiacritics.map((h) => h.article.slug));
    expect(withDiacritics.length).toBeGreaterThan(0);
  });

  it("prázdny dopyt nevráti nič (žiadny 'zobraz všetko' efekt)", () => {
    expect(searchHelpArticles(HELP_TOPICS, "")).toEqual([]);
    expect(searchHelpArticles(HELP_TOPICS, "   ")).toEqual([]);
  });

  it("nesúvisiaci dopyt nevráti nič", () => {
    expect(searchHelpArticles(HELP_TOPICS, "traktor kombajn")).toEqual([]);
  });
});

describe("searchHelpArticles — slovo po slove, nie presná fráza", () => {
  const topics: HelpTopic[] = [
    { slug: "t", label: "T", icon: "clock", roles: ["employee"], articles: [{ slug: "a", title: "Titulok jeden dva", summary: "", roles: ["employee"], steps: [{ text: "x" }] }] },
  ];

  it("nájde zhodu aj keď sú slová v inom poradí", () => {
    expect(searchHelpArticles(topics, "dva jeden").map((h) => h.article.slug)).toEqual(["a"]);
  });

  it("nenájde, ak čo aj len jedno slovo z dopytu chýba", () => {
    expect(searchHelpArticles(topics, "jeden tri")).toEqual([]);
  });
});

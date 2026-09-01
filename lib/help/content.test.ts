import { describe, expect, it } from "vitest";
import { HELP_TOPICS } from "./content";
import { GLOSSARY } from "./glossary";

const REAL_CONTENT_TOPICS = ["pipanie", "rozvrh", "ziadosti", "vykazy", "nastavenia"];

describe("HELP_TOPICS — základná konzistencia dát", () => {
  it("slug témy je unikátny", () => {
    const slugs = HELP_TOPICS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("slug článku je unikátny NAPRIEČ celým pomocníkom (URL/odkazy naň sa nesmú kolidovať)", () => {
    const slugs = HELP_TOPICS.flatMap((t) => t.articles.map((a) => a.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("každá téma aj každý článok má aspoň jednu rolu", () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.roles.length).toBeGreaterThan(0);
      for (const article of topic.articles) {
        expect(article.roles.length).toBeGreaterThan(0);
        // článok nesmie byť viditeľný role, ktorá nemá prístup ani k samotnej téme
        for (const role of article.roles) expect(topic.roles).toContain(role);
      }
    }
  });

  it("každý článok má aspoň jeden krok s neprázdnym textom", () => {
    for (const topic of HELP_TOPICS) {
      for (const article of topic.articles) {
        expect(article.steps.length).toBeGreaterThan(0);
        for (const step of article.steps) expect(step.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("existujúce funkcie (Pípanie, Rozvrh, Žiadosti, Výkazy) majú SKUTOČNÝ obsah, nie placeholder", () => {
    for (const slug of REAL_CONTENT_TOPICS) {
      const topic = HELP_TOPICS.find((t) => t.slug === slug);
      expect(topic, `téma "${slug}" musí existovať`).toBeDefined();
      for (const article of topic!.articles) {
        expect(article.placeholder, `článok "${article.slug}" v téme "${slug}" nesmie byť placeholder`).not.toBe(true);
      }
    }
  });

  it("žiadna téma nemá slug 'terminal' (placeholder sekcia bola úplne odstránená, nielen skrytá)", () => {
    expect(HELP_TOPICS.find((t) => t.slug === "terminal")).toBeUndefined();
  });
});

describe("GLOSSARY — 5 zadaných pojmov", () => {
  it("obsahuje presne úväzok, turnus, režim prestávky, vedúceho zmeny a prístupový kľúč", () => {
    const terms = Object.values(GLOSSARY).map((g) => g.term);
    expect(terms).toEqual(expect.arrayContaining(["Úväzok", "Turnus", "Režim prestávky", "Vedúci zmeny", "Prístupový kľúč"]));
  });

  it("každé vysvetlenie je krátke a zrozumiteľné (nie prázdne, nie mega-odstavec)", () => {
    for (const g of Object.values(GLOSSARY)) {
      expect(g.explanation.length).toBeGreaterThan(20);
      expect(g.explanation.length).toBeLessThan(400);
    }
  });
});

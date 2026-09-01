import { describe, expect, it } from "vitest";
import { filterHelpTopicsForRole } from "./filter";
import type { HelpTopic } from "./types";

const TOPICS: HelpTopic[] = [
  {
    slug: "spolocna",
    label: "Spoločná téma",
    icon: "clock",
    roles: ["owner", "manager", "employee"],
    articles: [
      { slug: "a1", title: "Pre všetkých", summary: "s", roles: ["owner", "manager", "employee"], steps: [{ text: "x" }] },
      { slug: "a2", title: "Len pre manažéra", summary: "s", roles: ["owner", "manager"], steps: [{ text: "x" }] },
    ],
  },
  {
    slug: "len-owner",
    label: "Len majiteľ",
    icon: "settings",
    roles: ["owner"],
    articles: [{ slug: "b1", title: "Owner only", summary: "s", roles: ["owner"], steps: [{ text: "x" }] }],
  },
];

describe("filterHelpTopicsForRole", () => {
  it("zamestnanec vidí spoločný článok, ale NIE manažérsky článok v tej istej téme, a nevidí tému 'Len majiteľ' vôbec", () => {
    const result = filterHelpTopicsForRole(TOPICS, "employee");
    expect(result.map((t) => t.slug)).toEqual(["spolocna"]);
    expect(result[0].articles.map((a) => a.slug)).toEqual(["a1"]);
  });

  it("manažér vidí oba články spoločnej témy, ale NIE tému 'Len majiteľ'", () => {
    const result = filterHelpTopicsForRole(TOPICS, "manager");
    expect(result.map((t) => t.slug)).toEqual(["spolocna"]);
    expect(result[0].articles.map((a) => a.slug)).toEqual(["a1", "a2"]);
  });

  it("owner vidí úplne všetko", () => {
    const result = filterHelpTopicsForRole(TOPICS, "owner");
    expect(result.map((t) => t.slug)).toEqual(["spolocna", "len-owner"]);
  });

  it("účtovníčka bez prístupu k žiadnej téme dostane prázdny zoznam, nie chybu", () => {
    const result = filterHelpTopicsForRole(TOPICS, "accountant");
    expect(result).toEqual([]);
  });

  it("téma, ktorej VŠETKY články sú pre inú rolu, sa nezobrazí (prázdna téma je zbytočný šum)", () => {
    const onlyOwnerArticleTopic: HelpTopic[] = [
      { slug: "t", label: "T", icon: "clock", roles: ["owner", "employee"], articles: [{ slug: "a", title: "a", summary: "s", roles: ["owner"], steps: [{ text: "x" }] }] },
    ];
    expect(filterHelpTopicsForRole(onlyOwnerArticleTopic, "employee")).toEqual([]);
  });
});

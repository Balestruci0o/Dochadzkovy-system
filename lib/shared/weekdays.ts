// ISO 8601 poradie: 1 = pondelok ... 7 = nedeľa.
export const WEEKDAYS = [
  { value: 1, label: "Pondelok", short: "Po" },
  { value: 2, label: "Utorok", short: "Ut" },
  { value: 3, label: "Streda", short: "St" },
  { value: 4, label: "Štvrtok", short: "Št" },
  { value: 5, label: "Piatok", short: "Pi" },
  { value: 6, label: "Sobota", short: "So" },
  { value: 7, label: "Nedeľa", short: "Ne" },
] as const;

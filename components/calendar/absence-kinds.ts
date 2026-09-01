import type { absenceKindEnum } from "@/lib/db/schema";

export type AbsenceKind = (typeof absenceKindEnum.enumValues)[number];

export const ABSENCE_KIND_CONFIG: Record<AbsenceKind, { label: string; code: string; color: string }> = {
  dovolenka: { label: "Dovolenka", code: "DOV", color: "#7E9082" },
  pn: { label: "PN — Práceneschopnosť", code: "PN", color: "#C0392B" },
  ocr: { label: "OČR", code: "OČR", color: "#B0651E" },
  paragraf: { label: "Paragraf / lekár", code: "PAR", color: "#8E6FB0" },
  neplatene: { label: "Neplatené voľno", code: "NV", color: "#9C988E" },
  nahradne_volno: { label: "Náhradné voľno", code: "NáhV", color: "#3E7C8C" },
};

export const ABSENCE_KIND_OPTIONS = (Object.keys(ABSENCE_KIND_CONFIG) as AbsenceKind[]).map((value) => ({
  value,
  ...ABSENCE_KIND_CONFIG[value],
}));

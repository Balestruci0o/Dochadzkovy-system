import { StyleSheet } from "@react-pdf/renderer";

/**
 * Blok 12 (PDF) — vizuál ZÁMERNE NEDOLAĎOVANÝ, presnú podobu tlačiva si
 * každá firma prispôsobí vlastnému vzoru. Farby aspoň orientačne podľa
 * predvolenej palety appky (`app/globals.css`), nič viac.
 */
export const COLORS = {
  ink: "#1c1b19",
  inkSoft: "#6a675f",
  inkFaint: "#9c988e",
  orange: "#e0700f",
  sage: "#5c6e60",
  line: "#e7e3da",
  cream2: "#f3efe7",
};

export const styles = StyleSheet.create({
  page: { fontFamily: "Roboto", fontSize: 9, padding: 28, color: COLORS.ink },
  pageWide: { fontFamily: "Roboto", fontSize: 8, padding: 24, color: COLORS.ink },

  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, paddingBottom: 10, borderBottom: `1pt solid ${COLORS.line}` },
  brand: { fontSize: 14, fontWeight: "bold" },
  brandSub: { fontSize: 8, color: COLORS.inkSoft, marginTop: 2 },
  metaBlock: { fontSize: 8, color: COLORS.inkSoft, textAlign: "right" },

  title: { fontSize: 16, fontWeight: "bold", marginBottom: 3 },
  subtitle: { fontSize: 9, color: COLORS.inkSoft, marginBottom: 14 },

  infoRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  infoBox: { flex: 1, borderRadius: 4, border: `1pt solid ${COLORS.line}`, padding: 8 },
  infoLabel: { fontSize: 7, color: COLORS.inkFaint, marginBottom: 3, textTransform: "uppercase" },
  infoValue: { fontSize: 13, fontWeight: "bold" },

  grid2: { flexDirection: "row", gap: 20, marginBottom: 14 },
  col: { flex: 1 },
  sectionHeading: { fontSize: 9, fontWeight: "bold", marginBottom: 6, color: COLORS.inkSoft, textTransform: "uppercase" },

  miniRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderBottom: `0.5pt solid ${COLORS.line}` },
  miniLabel: { color: COLORS.inkSoft },
  miniValue: { fontWeight: "bold" },

  table: { display: "flex", width: "auto", marginTop: 4 },
  tr: { flexDirection: "row", borderBottom: `0.5pt solid ${COLORS.line}` },
  trHead: { flexDirection: "row", backgroundColor: COLORS.cream2, paddingVertical: 4 },
  trTotal: { flexDirection: "row", borderTop: `1pt solid ${COLORS.ink}`, paddingVertical: 4, fontWeight: "bold" },
  th: { fontSize: 7, fontWeight: "bold", textTransform: "uppercase", color: COLORS.inkSoft, paddingHorizontal: 3 },
  td: { fontSize: 8, paddingVertical: 3, paddingHorizontal: 3 },
  right: { textAlign: "right" },

  legal: { marginTop: 12, fontSize: 7, color: COLORS.inkFaint, lineHeight: 1.4 },
  foot: { marginTop: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  signLine: { width: 160, borderTop: `1pt solid ${COLORS.ink}`, paddingTop: 3, fontSize: 7, color: COLORS.inkSoft, textAlign: "center" },
});

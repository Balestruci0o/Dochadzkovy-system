export const ATTENDANCE_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  planned: { label: "Naplánované", color: "#9C988E" },
  working: { label: "V práci", color: "#E0700F" },
  done: { label: "Odpracované", color: "#5C8A5E" },
  absent: { label: "Neprítomnosť", color: "#9C988E" },
  missing: { label: "Chýba", color: "#C9692E" },
  auto_closed: { label: "Automaticky uzavreté", color: "#C9692E" },
};

export function fmtTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("sk-SK", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bratislava" });
}

export function fmtHours(h: number | string | null): string {
  const n = typeof h === "string" ? Number(h) : (h ?? 0);
  if (!n) return "0 h";
  return `${n.toFixed(1).replace(".0", "")} h`;
}

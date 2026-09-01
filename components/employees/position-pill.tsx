export function PositionPill({ name, color }: { name: string | null; color?: string | null }) {
  if (!name) {
    return <span className="text-sm text-ink-faint">Bez pozície</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft">
      <span className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: color ?? "#9C988E" }} />
      {name}
    </span>
  );
}

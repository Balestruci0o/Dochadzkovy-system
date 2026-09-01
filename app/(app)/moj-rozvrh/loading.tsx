export default function MojRozvrhLoading() {
  return (
    <div className="animate-pulse rounded-[14px] border border-line bg-paper p-5 shadow-sm">
      <div className="grid grid-cols-7 gap-[7px]">
        {Array.from({ length: 35 }, (_, i) => (
          <div key={i} className="min-h-[78px] rounded-[10px] bg-cream-2" />
        ))}
      </div>
    </div>
  );
}

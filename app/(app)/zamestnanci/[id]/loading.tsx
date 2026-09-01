export default function ZamestnanecDetailLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5">
      <div className="h-20 rounded-[14px] border border-line bg-paper shadow-sm" />
      <div className="h-32 rounded-[14px] border border-line bg-paper shadow-sm" />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="h-40 rounded-[14px] border border-line bg-paper shadow-sm" />
        <div className="h-40 rounded-[14px] border border-line bg-paper shadow-sm" />
      </div>
    </div>
  );
}

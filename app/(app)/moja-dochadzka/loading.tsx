export default function MojaDochadzkaLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-5">
      <div className="h-16 rounded-[14px] border border-line bg-paper shadow-sm" />
      <div className="rounded-[14px] border border-line bg-paper p-5 shadow-sm">
        <div className="mb-4 h-5 w-40 rounded bg-cream-2" />
        <div className="flex flex-col gap-2">
          <div className="h-12 rounded-md bg-cream-2" />
          <div className="h-12 rounded-md bg-cream-2" />
          <div className="h-12 rounded-md bg-cream-2" />
        </div>
      </div>
    </div>
  );
}

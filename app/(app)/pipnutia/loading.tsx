export default function PipnutiaLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="animate-pulse rounded-[14px] border border-line bg-paper p-4 shadow-sm">
        <div className="h-6 w-56 rounded bg-cream-2" />
      </div>
      <div className="animate-pulse rounded-[14px] border border-line bg-paper p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <div className="h-10 rounded-md bg-cream-2" />
          <div className="h-10 rounded-md bg-cream-2" />
          <div className="h-10 rounded-md bg-cream-2" />
        </div>
      </div>
    </div>
  );
}

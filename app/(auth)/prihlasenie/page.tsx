import { brand } from "@/lib/branding/config";
import { LoginForm } from "./login-form";

export default async function PrihlaseniePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-8 shadow-sm">
        <h1 className="font-serif text-2xl font-bold text-ink">Prihlásenie</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">Dochádzkový systém — {brand.name}</p>
        <LoginForm next={next} />
      </div>
    </div>
  );
}

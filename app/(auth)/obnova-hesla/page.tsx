import { ResetRequestForm } from "./reset-form";

export default function ObnovaHeslaPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-8 shadow-sm">
        <h1 className="font-serif text-2xl font-bold text-ink">Obnova hesla</h1>
        <p className="mb-6 mt-1 text-sm text-ink-soft">
          Zadaj email, na ktorý ti pošleme odkaz na nastavenie nového hesla.
        </p>
        <ResetRequestForm />
      </div>
    </div>
  );
}

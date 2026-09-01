"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { runGenerateAsUser } from "@/lib/scheduler/run-generate";

export type GenerateActionState = {
  error?: string;
  report?: {
    shiftsCreated: number;
    shiftsDeleted: number;
    shiftsSkippedLocked: number;
    gaps: { date: string; message: string }[];
  };
};

/**
 * Blok 9d-5 (🔍) — "Generovať/Pregenerovať rozvrh" tlačidlo v kalendári.
 * `requireRole` + `runGenerateAsUser` (→ `withUserContext`) zaručia, že
 * manažér vygeneruje LEN pre prevádzku, ku ktorej má prístup (RLS, nie
 * kontrola tu) — `workplaceId` z formulára je len to, ČO sa pýta, nie
 * autorizácia sama. Vracia ČITATEĽNÝ report (počty + presné dôvody dier,
 * Blok 9c Piece 4), nie surový výsledok na priame zobrazenie ako JSON.
 */
export async function generateScheduleAction(_prev: GenerateActionState, formData: FormData): Promise<GenerateActionState> {
  const user = await requireRole("owner", "manager");

  const workplaceId = String(formData.get("workplaceId") ?? "");
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!workplaceId || !year || !month) return { error: "Chýbajú údaje o prevádzke alebo mesiaci." };

  try {
    const report = await runGenerateAsUser(user.id, workplaceId, year, month);
    revalidatePath("/kalendar");
    return {
      report: {
        shiftsCreated: report.shiftsCreated,
        shiftsDeleted: report.shiftsDeleted,
        shiftsSkippedLocked: report.shiftsSkippedLocked,
        gaps: report.gaps,
      },
    };
  } catch (e) {
    // `loadGenerateInput` hádže vlastnú, už čitateľnú hlášku pre chýbajúci
    // prístup (RLS fail-safe) — tú pošleme presne tak, ako je. Čokoľvek iné
    // (DB výnimka a pod.) je interná chyba, nezobrazuj jej surový text.
    const message = e instanceof Error && e.message === "Prevádzka neexistuje alebo k nej nemáš prístup." ? e.message : "Generovanie zlyhalo. Skús to prosím znova, alebo over si nastavenia pokrytia a šablón smien.";
    return { error: message };
  }
}

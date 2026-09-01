import * as path from "node:path";
import { Font } from "@react-pdf/renderer";

/**
 * Blok 12 (PDF) — @react-pdf/renderer vstavané fonty (Helvetica...) sú
 * Standard-14 PDF fonty BEZ diakritiky, takže slovenský text by sa
 * zobrazil so zlými/chýbajúcimi znakmi (á, č, ľ, š, ž...). `@fontsource/*`
 * balíky sú zámerne rozdelené na sub-fonty PODĽA unicode rozsahu (kvôli
 * veľkosti pre web) — react-pdf ale pri jednom zaregistrovanom
 * {family, fontWeight} nerobí automatický fallback medzi viacerými takými
 * súbormi, takže znaky mimo rozsahu JEDNÉHO zvoleného súboru vypadli/boli
 * nahradené iným rezom (overené priamym renderom + vizuálnou kontrolou).
 * `roboto-fontface` namiesto toho nesie JEDEN nerozdelený súbor na váhu —
 * obsahuje celý Latin Extended-A rozsah potrebný pre slovenčinu.
 */
const FONT_DIR = path.join(process.cwd(), "node_modules/roboto-fontface/fonts/roboto");

let registered = false;

export function ensureFontsRegistered(): void {
  if (registered) return;
  Font.register({
    family: "Roboto",
    fonts: [
      { src: path.join(FONT_DIR, "Roboto-Regular.woff"), fontWeight: "normal" },
      { src: path.join(FONT_DIR, "Roboto-Bold.woff"), fontWeight: "bold" },
      { src: path.join(FONT_DIR, "Roboto-RegularItalic.woff"), fontWeight: "normal", fontStyle: "italic" },
    ],
  });
  registered = true;
}

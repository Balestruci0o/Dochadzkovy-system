import { Text } from "@react-pdf/renderer";

/**
 * Workaround pre nájdený bug vo fontkit/@react-pdf/renderer subsetovaní:
 * PRVÝ výskyt určitých glyfov (napr. veľké "M") v tučnom reze v konkrétnom
 * dokumente sa vedel v PDF strate (viditeľne chýbajúce písmeno v nadpise,
 * overené priamym vykreslením aj extrakciou textu — nie chyba v našom JSX).
 * Neviditeľný "zahrievací" text so VŠETKÝMI potrebnými znakmi (obe váhy) na
 * začiatku dokumentu prinúti subsetter zaregistrovať celú sadu glyfov
 * naraz, predtým než príde skutočný viditeľný obsah — obchádza konkrétnu
 * chybu, nie je to vizuálna zmena (fontSize 0.1, opacity 0).
 */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz áäčďéíľĺňóôŕšťúýž ÁÄČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ 0123456789 €,.-–—/:()×";

export function GlyphPrimer() {
  return (
    <>
      <Text style={{ fontSize: 0.1, opacity: 0 }}>{ALPHABET}</Text>
      <Text style={{ fontSize: 0.1, opacity: 0, fontWeight: "bold" }}>{ALPHABET}</Text>
      <Text style={{ fontSize: 0.1, opacity: 0, fontStyle: "italic" }}>{ALPHABET}</Text>
    </>
  );
}

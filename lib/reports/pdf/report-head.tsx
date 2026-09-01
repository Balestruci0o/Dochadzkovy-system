import { Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";

/**
 * Hlavička spoločná pre oba PDF výkazy — vizuál zámerne nedoladený (žiadne
 * logo, skutočné tlačivo príde od klienta). `ico` sa zobrazí len keď je
 * reálne vyplnené (`organizations.ico`) — nevymýšľame firemné údaje.
 */
export function ReportHead({ orgName, ico }: { orgName: string; ico: string | null }) {
  return (
    <View style={styles.head}>
      <View>
        <Text style={styles.brand}>{orgName}</Text>
        <Text style={styles.brandSub}>Evidencia pracovného času · §99 Zákonníka práce</Text>
      </View>
      <View style={styles.metaBlock}>
        {ico && <Text>IČO: {ico}</Text>}
        <Text>Vygenerované: {new Date().toLocaleDateString("sk-SK")}</Text>
      </View>
    </View>
  );
}

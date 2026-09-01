# Changelog

Formát vychádza z [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
verzovanie sa riadi [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-08-24

Prvé verejné vydanie.

### Pridané

- Evidencia príchodov a odchodov cez rotujúci QR terminál alebo web
- Automatické generovanie mesačného rozvrhu podľa pravidiel Zákonníka práce
  a dostupnosti zamestnancov, s konkrétnym hlásením, keď sa deň nedá
  obsadiť legálne
- Žiadosti o dovolenku, PN, OČR a ďalšie neprítomnosti so schvaľovaním
  manažérom
- Mesačné výkazy s exportom do Excelu a PDF
- Granulárne pravomoci manažérov (napr. kto vidí mzdy, kto schvaľuje
  žiadosti, kto upravuje rozvrh)
- Podpora viacerých prevádzok s izoláciou dát medzi nimi, vynútenou cez
  Row Level Security v databáze
- Inštalačný skript (`npm run setup`) na založenie prvej organizácie,
  prevádzky a majiteľa pri nasadení
- Konfigurovateľná značka (názov, logo, farby) bez zásahu do kódu
- CI (GitHub Actions): lint, typecheck, jednotkové testy a testy proti
  reálnej databáze

import type { Page } from "@playwright/test";

/**
 * Skryje jediný naozaj nedeterministický prvok v appke naprieč stránkami —
 * odznak počtu neprečítaných notifikácií (`components/layout/notification-bell.tsx`).
 * Panel notifikácií samotný je defaultne zatvorený (`open` state, `useState(false)`)
 * a appka nepoužíva žiadny toast/tooltip knižničný systém zobrazený na
 * načítaní stránky (overené grepom pred písaním tohto skriptu) — nie je čo
 * iné skrývať.
 */
export async function hideFlakyElements(page: Page) {
  await page.addStyleTag({
    content: [
      `button[aria-label="Notifikácie"] span { visibility: hidden !important; }`,
      // Next.js dev-only indikátor (next.config.ts, devIndicators.position:
      // "bottom-right") — v produkcii vôbec neexistuje, na screenshotoch
      // nemá čo robiť.
      `nextjs-portal { display: none !important; }`,
      // Nájdené pri skúške reprodukovateľnosti (Fáza S, oprava po nálezoch):
      // kliknutie v `prepare.ts` necháva virtuálny kurzor NAD kliknutým
      // prvkom, takže jeho `transition-colors` (hover) môže byť ešte
      // dobiehajúca v momente snímky — medzi dvoma bezreseedovými behmi sa
      // tak líšilo pár pixelov na hranici (`kalendar-cell-picker.png`).
      // `animate-pulse` (prebiehajúca zmena, `CellContent`) má rovnaký
      // problém. Vypnutie VŠETKÝCH prechodov/animácií len pre snímku toto
      // odstraňuje bez toho, aby to čokoľvek vizuálne zmenilo (statický
      // konečný stav vyzerá identicky).
      `*, *::before, *::after { transition: none !important; animation: none !important; }`,
    ].join("\n"),
  });
}

/**
 * `networkidle` ONA sama nestačí (RSC/streaming vie byť "idle" ešte pred
 * tým, čo used vidieť) — čaká sa navyše na konkrétny viditeľný text, ktorý
 * dokazuje, že je vykreslený skutočný obsah stránky, nie kostra/loading.
 */
export async function waitForReady(page: Page, readyText: string | RegExp) {
  await page.waitForLoadState("networkidle");
  await page.getByText(readyText).first().waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Strop nad ktorý sa strana už neberie celá, len jej zmysluplná horná
 * časť — bez tohto vie mobilný (úzky, teda vysoký) layout dlhej stránky
 * (celý mesačný kalendár, dlhý zoznam kont) vyprodukovať neprimerane
 * dlhý obrázok. Rovnaká funkcia sa volá pre desktop AJ mobil — žiadne
 * osobitné vetvenie medzi nimi.
 */
const MAX_PAGE_HEIGHT_CSS_PX = 1800;

/**
 * `page.screenshot({ clip })` BEZ `fullPage: true` zoberie len to, čo je
 * PRÁVE vykreslené vo viewporte — nescrolluje stránku, aby `clip` mohol
 * siahať aj za jeho hranicu. Skutočný nález (nie teória): keď je stránka
 * vyššia než viewport AJ strop, výsledný obrázok bol tichoDoREZANÝ na
 * presne `viewport.height`, nie na `MAX_PAGE_HEIGHT_CSS_PX` — napr.
 * `moj-rozvrh-kalendar-mobile` (skutočný obsah 2421 CSS px) skončil na
 * 664 CSS px (presne výška iPhone 13 viewportu), nie na zamýšľaných 1800.
 * `fullPage: true` KOMBINOVANÉ s `clip` je zdokumentovaný spôsob, ako
 * dostať "celá strana, ale orezaná na tento obdĺžnik".
 */

/**
 * Skutočný spodok OBSAHU — nie celej stránky. `app-shell.tsx` obaľuje
 * KAŽDÚ prihlásenú stránku do `<main><Topbar/><div class="... min-h-screen...">`
 * (presnejšie koreň `<div class="flex min-h-screen">`), takže krátky obsah
 * (napr. jednoduchý formulár) appka VIZUÁLNE dotiahne až na celú výšku
 * okna prázdnym miestom — `document.documentElement.scrollHeight` toto
 * prázdno nevidí ako "navyše", je to legitímna súčasť dokumentu. Meria sa
 * preto spodný okraj `main > div` (obsahový kontajner z `app-shell.tsx`,
 * riadok 34) — jeho `getBoundingClientRect().bottom` UŽ zahŕňa vlastné
 * spodné odsadenie (`pb-[60px]` a menšie varianty), netreba pridávať
 * ďalšiu rezervu. Stránky MIMO `AppShell` (napr. `/punch`, terminálová
 * obrazovka bez sidebaru) tento kontajner nemajú — `null` spadne späť na
 * celú výšku dokumentu, teda pôvodné správanie.
 *
 * NÁJDENÉ (nie teória) pri prvom nasadení: `CellPicker`
 * (`components/calendar/cell-picker.tsx`) je `position: fixed` — takýto
 * prvok NEROZŠIRUJE normálny tok dokumentu, takže `main > div` o ňom
 * nevie a orezanie odrezalo spodok OTVORENÉHO DIALÓGU
 * (`veduci-zmeny-priradenie` — tlačidlo "AJ TAK" zmizlo). Preto sa
 * naviac prejdú všetky `position: fixed` prvky a zoberie sa NAJNIŽŠÍ
 * spodný okraj spomedzi nich AJ obsahového kontajnera — všeobecné
 * riešenie pre KAŽDÝ budúci cieľ s fixed-position dialógom/pickerom, nie
 * len pre tento jeden.
 */
async function measureContentBottom(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const container = document.querySelector("main > div");
    let bottom = container ? container.getBoundingClientRect().bottom : null;

    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      if (getComputedStyle(el).position !== "fixed") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (bottom === null || rect.bottom > bottom) bottom = rect.bottom;
    }

    return bottom !== null ? Math.ceil(bottom) : null;
  });
}

export async function captureFullPage(page: Page, outPath: string) {
  await hideFlakyElements(page);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const contentBottom = await measureContentBottom(page);
  const viewport = page.viewportSize();

  // Základ orezania: spodok SKUTOČNÉHO obsahu, ak ho vieme zmerať (rieši
  // prázdne miesto od `min-h-screen`), inak celá výška dokumentu (stránky
  // mimo AppShell). Následne ešte orezané zhora stropom, ak treba.
  const contentHeight = contentBottom ?? documentHeight;
  const targetHeight = Math.min(contentHeight, MAX_PAGE_HEIGHT_CSS_PX);

  if (targetHeight >= documentHeight || !viewport) {
    await page.screenshot({ path: outPath, fullPage: true });
    return;
  }

  await page.screenshot({
    path: outPath,
    fullPage: true,
    clip: { x: 0, y: 0, width: viewport.width, height: targetHeight },
  });
}

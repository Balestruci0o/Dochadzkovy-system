import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev indicator býval v ľavom dolnom rohu presne tam, kde je odhlásenie
  // v sidebar footri — presunuté, nech si neprekáža.
  devIndicators: {
    position: "bottom-right",
  },
  // `lib/reports/pdf/fonts.ts` číta .woff súbory cez `fs`/`path.join(process.cwd(), ...)`
  // za behu (react-pdf `Font.register`), nie cez `import` — Next.js file-tracer preto
  // tieto súbory nevidí a na Verceli by ich do serverless bundlu vôbec nezabalil
  // (overené: `.next/server/app/api/vykazy/pdf/route.js.nft.json` po builde neobsahuje
  // ani jeden "roboto" súbor). Bez nich @react-pdf/renderer v produkcii zlyhá — PDF
  // export lokálne funguje (celý node_modules je na disku), na Verceli nie.
  outputFileTracingIncludes: {
    "/api/vykazy/pdf": ["./node_modules/roboto-fontface/fonts/roboto/*.woff"],
  },
};

export default nextConfig;

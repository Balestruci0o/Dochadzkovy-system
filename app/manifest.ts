import type { MetadataRoute } from "next";
import { brand, brandMeta } from "@/lib/branding/config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brandMeta.punchAppName,
    short_name: brand.shortName,
    description: "Rotujúci QR kód na pípanie príchodu a odchodu",
    start_url: "/punch",
    display: "standalone",
    orientation: "portrait",
    background_color: "#faf8f3",
    theme_color: "#1c1b19",
    icons: [
      { src: brand.logoSrc, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

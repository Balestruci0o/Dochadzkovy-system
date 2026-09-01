import type { Metadata } from "next";
import { Archivo, Spectral } from "next/font/google";
import "./globals.css";
// Poradie je zámerné — branding.css sa načíta AŽ PO globals.css, aby jeho
// (voliteľné) prebitia farebnej palety mali prednosť v CSS cascade.
import "./branding.css";
import { brand, brandMeta } from "@/lib/branding/config";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: brandMeta.title,
  description: brandMeta.description,
  icons: { apple: brand.logoSrc },
  appleWebApp: { capable: true, statusBarStyle: "default", title: brandMeta.punchAppName },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sk"
      className={`${archivo.variable} ${spectral.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

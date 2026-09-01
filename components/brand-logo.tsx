import Image from "next/image";
import { brand } from "@/lib/branding/config";

/**
 * Zámerne `next/image` nad súborom (`brand.logoSrc`), nie inline SVG kód —
 * vďaka tomu si firma vymení logo prepísaním jedného súboru
 * (`public/branding/logo.svg`, prípadne inou cestou cez
 * `NEXT_PUBLIC_BRAND_LOGO`) bez nutnosti rebuildu appky. `unoptimized`, lebo
 * ide o lokálny statický súbor bez potreby Next.js optimalizačného pipeline.
 */
export function BrandLogo({ size = 50, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={brand.logoSrc}
      alt={brand.name}
      width={size}
      height={size}
      unoptimized
      priority
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}

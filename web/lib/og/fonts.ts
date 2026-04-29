import {readFileSync} from "fs";
import {join} from "path";

/// Lazy-init the OG font payloads. Read once at first ImageResponse render;
/// subsequent renders reuse the cached buffers.
///
/// Static instances only — Satori (the renderer behind ImageResponse)
/// chokes on multi-axis variable TTFs ("Cannot read properties of
/// undefined (reading '256')" during glyph table parsing). All sources:
///   • Geist Regular/SemiBold (TTF) — vercel/geist-font
///   • Geist Mono Regular (TTF)     — vercel/geist-font
///   • Fraunces 600 (WOFF)          — fontsource/font-files
///   • Special Elite Regular (TTF)  — google/fonts

interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal" | "italic";
}

let cached: OgFont[] | null = null;

function load(filename: string): Buffer {
  return readFileSync(join(process.cwd(), "public/fonts/og", filename));
}

export function getOgFonts(): OgFont[] {
  if (cached) return cached;
  cached = [
    {name: "Geist", data: load("Geist-Regular.ttf"), weight: 400, style: "normal"},
    {name: "Geist", data: load("Geist-SemiBold.ttf"), weight: 600, style: "normal"},
    {name: "GeistMono", data: load("GeistMono-Regular.ttf"), weight: 400, style: "normal"},
    {name: "Fraunces", data: load("Fraunces-600.woff"), weight: 600, style: "normal"},
    {name: "SpecialElite", data: load("SpecialElite-Regular.ttf"), weight: 400, style: "normal"},
  ];
  return cached;
}

import type {MetadataRoute} from "next";

import {getDarkOddsMarkets} from "@/lib/darkodds/markets";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://darkodds.site";

/// Static sitemap entries — every public route the app exposes. Per-market
/// detail pages are appended dynamically below.
const STATIC_ROUTES = [
  {path: "/", priority: 1.0},
  {path: "/markets", priority: 0.9},
  {path: "/portfolio", priority: 0.6},
  {path: "/audit", priority: 0.6},
  {path: "/create", priority: 0.7},
  {path: "/privacy", priority: 0.3},
  {path: "/terms", priority: 0.3},
  {path: "/disclaimer", priority: 0.3},
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const baseEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((r) => ({
    url: `${APP_URL}${r.path}`,
    lastModified: now,
    changeFrequency: r.path === "/markets" ? "hourly" : "weekly",
    priority: r.priority,
  }));

  // Best-effort fetch of live DarkOdds markets. If the chain reader fails
  // we still return the static routes — sitemap should never 500.
  const marketEntries: MetadataRoute.Sitemap = [];
  try {
    const {markets} = await getDarkOddsMarkets();
    for (const m of markets) {
      marketEntries.push({
        url: `${APP_URL}/markets/${m.id}`,
        lastModified: now,
        changeFrequency: "hourly",
        priority: 0.8,
      });
    }
  } catch {
    // chain RPC down at build time — sitemap regenerates on next request
  }

  return [...baseEntries, ...marketEntries];
}

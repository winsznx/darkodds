/**
 * Polymarket Gamma API client — server-side only.
 *
 * The single site in the codebase that calls JSON.parse() on the
 * stringified `outcomes` / `outcomePrices` fields. Every other consumer
 * (components, F11 clone flow) sees the normalized `PolymarketMarket`
 * type with real arrays and parsed probabilities.
 *
 * Caching uses Next.js 16's "Previous Model" (fetch + next.revalidate)
 * because Cache Components ('use cache' + cacheLife) requires opting the
 * whole app into Partial Prerendering — out of scope for F8. Documented
 * in DRIFT_LOG.
 */

import {
  type GetMarketsFilters,
  type PolymarketMarket,
  type PolymarketResult,
  type PolymarketTag,
  polymarketEventId,
  polymarketMarketId,
} from "./types";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const POLYMARKET_EVENT_BASE = "https://polymarket.com/event";

const REVALIDATE_LIST = 60; // seconds
const REVALIDATE_SINGLE = 30; // seconds
const FETCH_TIMEOUT_MS = 6_000;
const RETRY_BACKOFF_MS = 250;

// ────────────────────────────────────────────────────────────────────────────
// Raw wire shape — kept private to this module. The fields we care about,
// plus a passthrough `[key: string]: unknown` because Gamma's response has
// 70+ fields and we explicitly don't need them.
// ────────────────────────────────────────────────────────────────────────────

interface GammaEventRaw {
  id?: string;
  slug?: string;
  title?: string;
}

interface GammaTagRaw {
  id: string;
  label: string;
  slug: string;
  forceHide?: boolean;
  forceShow?: boolean;
}

interface GammaMarketRaw {
  id: string;
  conditionId: string;
  slug: string;
  question: string | null;
  description?: string | null;
  groupItemTitle?: string | null;
  endDate: string | null;
  endDateIso?: string | null;
  startDate?: string | null;
  startDateIso?: string | null;
  outcomes: string | null; // JSON-stringified — see docs/POLYMARKET_INTEGRATION.md
  outcomePrices: string | null; // JSON-stringified — see docs
  clobTokenIds?: string | null; // JSON-stringified — see docs
  volumeNum: number | null;
  volume24hr: number | null;
  liquidityNum: number | null;
  active: boolean | null;
  closed: boolean | null;
  acceptingOrders: boolean | null;
  image: string | null;
  icon?: string | null;
  resolutionSource?: string | null;
  events?: GammaEventRaw[] | null;
  tags?: GammaTagRaw[] | null;
}

// ────────────────────────────────────────────────────────────────────────────
// fetch wrapper — adds timeout, retry-once-on-5xx, returns typed Result
// ────────────────────────────────────────────────────────────────────────────

async function gammaFetch<T>(path: string, revalidate: number): Promise<PolymarketResult<T | null>> {
  const url = `${GAMMA_BASE}${path}`;

  const tryOnce = async (): Promise<PolymarketResult<T | null>> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        next: {revalidate},
      });
      if (res.status === 404) {
        return {ok: false, data: null, error: {kind: "404", status: 404, message: `Not found: ${path}`}};
      }
      if (res.status >= 500) {
        return {
          ok: false,
          data: null,
          error: {kind: "5xx", status: res.status, message: `Gamma ${res.status} on ${path}`},
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          data: null,
          error: {kind: "network", status: res.status, message: `Gamma ${res.status} on ${path}`},
        };
      }
      try {
        const json = (await res.json()) as T;
        return {ok: true, data: json};
      } catch (parseErr) {
        const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
        return {ok: false, data: null, error: {kind: "parse", message}};
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const kind = isAbort ? "timeout" : "network";
      const message = err instanceof Error ? err.message : String(err);
      return {ok: false, data: null, error: {kind, message}};
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const first = await tryOnce();
  if (first.ok) return first;
  if (first.error.kind === "5xx" || first.error.kind === "network" || first.error.kind === "timeout") {
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
    const second = await tryOnce();
    if (second.ok) return second;
  }
  return first;
}

// ────────────────────────────────────────────────────────────────────────────
// THE single normalizer. Calls JSON.parse() exactly twice per market
// (outcomes + outcomePrices) and never anywhere else in the codebase.
// ────────────────────────────────────────────────────────────────────────────

function normalizeMarket(raw: GammaMarketRaw): PolymarketMarket | null {
  // Reject markets missing the basics we render.
  if (!raw.id || !raw.slug || !raw.question || !raw.outcomes || !raw.outcomePrices) {
    return null;
  }

  let labels: string[];
  let probStrings: string[];
  try {
    labels = JSON.parse(raw.outcomes) as string[];
    probStrings = JSON.parse(raw.outcomePrices) as string[];
  } catch {
    return null;
  }
  if (!Array.isArray(labels) || !Array.isArray(probStrings) || labels.length !== probStrings.length) {
    return null;
  }

  const outcomes = labels.map((label, i) => {
    const probability = Number(probStrings[i]);
    return {
      label,
      probability: Number.isFinite(probability) ? probability : 0,
    };
  });

  // clobTokenIds — JSON-stringified parallel array. Best-effort parse;
  // missing/malformed leaves it empty (the /create clone flow can degrade
  // gracefully without it).
  let clobTokenIds: string[] = [];
  if (raw.clobTokenIds) {
    try {
      const parsed = JSON.parse(raw.clobTokenIds) as unknown;
      if (Array.isArray(parsed) && parsed.every((x): x is string => typeof x === "string")) {
        clobTokenIds = parsed;
      }
    } catch {
      // ignore — clobTokenIds is optional for display
    }
  }

  // Tags — first non-`forceHide` is the surfaced category. Empty if
  // include_tag=true wasn't on the request (or the market has no tags).
  const tags: PolymarketTag[] = (raw.tags ?? []).map((t) => ({
    id: t.id,
    label: t.label,
    slug: t.slug,
    forceHide: t.forceHide ?? false,
    forceShow: t.forceShow ?? false,
  }));
  const categoryTag = tags.find((t) => !t.forceHide);
  const category = categoryTag ? categoryTag.label : null;

  // First (and usually only) parent event surfaces eventId/eventSlug for
  // /create clone flow.
  const event = raw.events?.[0];
  const eventId = event?.id ? polymarketEventId(event.id) : null;
  const eventSlug = event?.slug ?? null;
  const eventTitle = event?.title ?? null;

  // Polymarket canonical URL: /event/<eventSlug>, falling back to the
  // market slug if the event is missing.
  const url = `${POLYMARKET_EVENT_BASE}/${eventSlug ?? raw.slug}`;

  const endDateStr = raw.endDateIso ?? raw.endDate;
  const endDate = endDateStr ? new Date(endDateStr) : null;
  const startDateStr = raw.startDateIso ?? raw.startDate ?? null;
  const startDate = startDateStr ? new Date(startDateStr) : null;

  return {
    id: polymarketMarketId(raw.id),
    conditionId: (raw.conditionId.startsWith("0x")
      ? raw.conditionId
      : `0x${raw.conditionId}`) as `0x${string}`,
    slug: raw.slug,
    url,
    question: raw.question,
    description: raw.description ?? "",
    groupItemTitle: raw.groupItemTitle ?? null,
    category,
    tags,
    endDate,
    startDate,
    outcomes,
    clobTokenIds,
    volumeUsd: raw.volumeNum ?? 0,
    volume24hrUsd: raw.volume24hr ?? 0,
    liquidityUsd: raw.liquidityNum ?? 0,
    active: raw.active ?? false,
    closed: raw.closed ?? false,
    acceptingOrders: raw.acceptingOrders ?? false,
    imageUrl: raw.image ?? raw.icon ?? null,
    iconUrl: raw.icon ?? raw.image ?? null,
    resolutionSource: raw.resolutionSource ?? "",
    eventId,
    eventSlug,
    eventTitle,
  };
}

function buildListQuery(filters: GetMarketsFilters): string {
  const params = new URLSearchParams();
  if (filters.active !== undefined) params.set("active", String(filters.active));
  if (filters.closed !== undefined) params.set("closed", String(filters.closed));
  if (filters.order) params.set("order", filters.order);
  if (filters.ascending !== undefined) params.set("ascending", String(filters.ascending));
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  // Always request tag joins — the cards' category pills + filter UI rely
  // on this. Costs ~5% extra payload but no extra round-trip.
  params.set("include_tag", "true");
  return `?${params.toString()}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a list of Polymarket markets. Filters that aren't Gamma-native (today
 * just `category`) are applied client-side after normalization.
 *
 * Returns degraded-but-rendering — even on Gamma 5xx, callers get
 * `{ok: false, data: [], error}` so the UI can render an empty Polymarket
 * column without crashing the whole page.
 */
export async function getMarkets(
  filters: GetMarketsFilters = {},
): Promise<PolymarketResult<PolymarketMarket[]>> {
  const query = buildListQuery({
    active: true,
    closed: false,
    limit: 100,
    order: "volume24hr",
    ascending: false,
    ...filters,
  });
  const result = await gammaFetch<GammaMarketRaw[]>(`/markets${query}`, REVALIDATE_LIST);

  if (!result.ok) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[polymarket] degraded /markets — ${result.error.kind}: ${result.error.message}`);
    }
    return {ok: false, data: [], error: result.error};
  }
  if (!Array.isArray(result.data)) {
    return {
      ok: false,
      data: [],
      error: {kind: "parse", message: "Gamma /markets did not return an array"},
    };
  }
  let normalized = result.data.map(normalizeMarket).filter((m): m is PolymarketMarket => m !== null);
  if (filters.category) {
    const target = filters.category.toLowerCase();
    normalized = normalized.filter(
      (m) =>
        (m.category ?? "").toLowerCase() === target || m.tags.some((t) => t.label.toLowerCase() === target),
    );
  }
  return {ok: true, data: normalized};
}

/** Fetch a single Polymarket market by numeric id. */
export async function getMarketById(id: string): Promise<PolymarketResult<PolymarketMarket | null>> {
  const result = await gammaFetch<GammaMarketRaw>(`/markets/${id}?include_tag=true`, REVALIDATE_SINGLE);
  if (!result.ok) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[polymarket] degraded /markets/${id} — ${result.error.kind}: ${result.error.message}`);
    }
    return {ok: false, data: null, error: result.error};
  }
  if (!result.data) {
    return {ok: false, data: null, error: {kind: "404", status: 404, message: `Market ${id} not found`}};
  }
  const normalized = normalizeMarket(result.data);
  if (!normalized) {
    return {
      ok: false,
      data: null,
      error: {kind: "parse", message: `Market ${id} failed normalization`},
    };
  }
  return {ok: true, data: normalized};
}

/**
 * Fetch a single Polymarket market by URL slug. Uses the documented
 * `?slug=<slug>` filter on the list endpoint, which returns an array of ≤1.
 *
 * F11 clone flow target: /create will call this with a user-pasted Polymarket
 * URL's slug to seed a DarkOdds market clone.
 */
export async function getMarketBySlug(slug: string): Promise<PolymarketResult<PolymarketMarket | null>> {
  const result = await gammaFetch<GammaMarketRaw[]>(
    `/markets?slug=${encodeURIComponent(slug)}&include_tag=true`,
    REVALIDATE_SINGLE,
  );
  if (!result.ok) return {ok: false, data: null, error: result.error};
  const arr = result.data ?? [];
  if (!Array.isArray(arr) || arr.length === 0) {
    return {ok: false, data: null, error: {kind: "404", status: 404, message: `Slug ${slug} not found`}};
  }
  const normalized = normalizeMarket(arr[0]);
  if (!normalized) {
    return {ok: false, data: null, error: {kind: "parse", message: `Slug ${slug} failed normalization`}};
  }
  return {ok: true, data: normalized};
}

/**
 * Polymarket data layer smoke — runnable via `pnpm --filter web exec tsx
 * lib/polymarket/__smoke__.ts`. Hits real Gamma, prints normalized output.
 *
 * Tests:
 *  1. getMarkets({limit: 5}) — top 5 by 24h volume.
 *  2. getMarketById(<first id>) — round-trip the id we just saw.
 *  3. getMarketBySlug(<first slug>) — round-trip via slug filter.
 *  4. Negative path: getMarketById("0") — confirm 404 error envelope.
 *
 * Exit code 0 on full success, 1 on any failure.
 */

import {getMarketById, getMarketBySlug, getMarkets} from "./index";

const fmt = (n: number, dp = 0): string =>
  n.toLocaleString("en-US", {maximumFractionDigits: dp, minimumFractionDigits: dp});

async function main(): Promise<void> {
  let failures = 0;

  console.log("─".repeat(72));
  console.log(" POLYMARKET DATA LAYER — SMOKE TEST");
  console.log(" target: gamma-api.polymarket.com");
  console.log("─".repeat(72));

  // 1. List
  console.log("\n[1] getMarkets({limit: 5}) — top by 24h volume");
  const list = await getMarkets({limit: 5});
  if (!list.ok) {
    console.error(`  FAIL — ${list.error.kind} ${list.error.message}`);
    failures += 1;
  } else if (list.data.length === 0) {
    console.error(`  FAIL — empty list`);
    failures += 1;
  } else {
    console.log(`  PASS — got ${list.data.length} markets`);
    for (const m of list.data) {
      const yes = m.outcomes[0];
      const no = m.outcomes[1];
      console.log(
        `    · ${m.id.padEnd(8)} ${(m.question ?? "").slice(0, 56).padEnd(56)} ` +
          `vol=$${fmt(m.volumeUsd)} ` +
          `${yes?.label}=${(yes?.probability * 100).toFixed(1)}% ` +
          `${no?.label}=${(no?.probability * 100).toFixed(1)}%`,
      );
      console.log(`      url=${m.url}  event=${m.eventSlug ?? "—"}`);
    }
  }

  if (!list.ok || list.data.length === 0) {
    console.error("\nCannot continue without a list. Aborting.");
    process.exit(1);
  }
  const first = list.data[0];

  // 2. Round-trip by id
  console.log(`\n[2] getMarketById(${first.id})`);
  const single = await getMarketById(first.id);
  if (!single.ok || !single.data) {
    console.error(`  FAIL — ${single.ok ? "null data" : single.error.message}`);
    failures += 1;
  } else if (single.data.id !== first.id) {
    console.error(`  FAIL — id mismatch ${single.data.id} vs ${first.id}`);
    failures += 1;
  } else {
    console.log(`  PASS — id matches; outcomes=${single.data.outcomes.map((o) => o.label).join("/")}`);
  }

  // 3. Round-trip by slug
  console.log(`\n[3] getMarketBySlug(${first.slug})`);
  const bySlug = await getMarketBySlug(first.slug);
  if (!bySlug.ok || !bySlug.data) {
    console.error(`  FAIL — ${bySlug.ok ? "null data" : bySlug.error.message}`);
    failures += 1;
  } else if (bySlug.data.id !== first.id) {
    console.error(`  FAIL — id mismatch ${bySlug.data.id} vs ${first.id}`);
    failures += 1;
  } else {
    console.log(`  PASS — slug round-trip resolved to id ${bySlug.data.id}`);
  }

  // 4. Negative path — id that won't exist
  console.log(`\n[4] getMarketById("0") — expecting 404`);
  const notFound = await getMarketById("0");
  if (notFound.ok) {
    console.error(`  FAIL — expected error, got ok`);
    failures += 1;
  } else if (notFound.error.kind !== "404") {
    console.error(`  FAIL — expected 404, got ${notFound.error.kind} ${notFound.error.message}`);
    failures += 1;
  } else {
    console.log(`  PASS — 404 error envelope returned`);
  }

  console.log("\n" + "─".repeat(72));
  if (failures > 0) {
    console.error(` SMOKE FAILED — ${failures} failure(s)`);
    process.exit(1);
  }
  console.log(" SMOKE GREEN — Polymarket data layer reachable + normalizing");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(1);
});

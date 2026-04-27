// SPDX-License-Identifier: MIT
//
// F7 — Operator verification script for the Faucet contract on Arb Sepolia.
// Same pattern as tools/verify-backend.ts but tightly scoped to F7 deliverables.
//
// 7 steps (all read-only except step 5 which sends the claim tx):
//   1. Read Faucet address from deployments.
//   2. Connect to chain — print block.
//   3. Read Faucet TestUSDC balance — assert ≥ 10M.
//   4. Read deployer's TestUSDC balance pre-claim.
//   5. Claim from Faucet via deployer EOA (DEPLOYER_PRIVATE_KEY).
//      NOTE: this consumes a 6h cooldown for the deployer address. Re-runs
//      within 6h will revert at this step — that's expected.
//   6. Read deployer's TestUSDC balance post-claim — assert delta == 1000.
//   7. Read Faucet.claimableAt(deployer) — assert in future.
//
// Usage:
//   pnpm verify:f7                       # interactive (TTY required)
//   pnpm verify:f7 -- --non-interactive  # CI / agent mode
//
// Output:
//   verification-output/<timestamp>/
//     ├── transcript.txt
//     ├── arbiscan-links.md
//     └── final-balances.json

import * as readline from "node:readline/promises";
import {appendFileSync, mkdirSync, writeFileSync} from "node:fs";
import {readFileSync} from "node:fs";
import {stdin, stdout} from "node:process";

import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  type Hex,
  type Address,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";

const NON_INTERACTIVE = process.argv.includes("--non-interactive");

const ARB_SCAN = "https://sepolia.arbiscan.io";
const CLAIM_AMOUNT = 1_000n * 1_000_000n;
const FAUCET_FUNDING_FLOOR = 10_000_000n * 1_000_000n;

const TUSDC_ABI = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

const FAUCET_ABI = parseAbi([
  "function claim() external",
  "function claimableAt(address user) view returns (uint256)",
  "function token() view returns (address)",
  "function CLAIM_AMOUNT() view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
]);

type LinkRow = {step: string; description: string; tx: Hex};
const arbiscanLinks: LinkRow[] = [];

const runStartedAt = new Date();
const stamp = runStartedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUTDIR = `${process.cwd()}/verification-output/${stamp}`;
mkdirSync(OUTDIR, {recursive: true});
const TRANSCRIPT = `${OUTDIR}/transcript.txt`;
writeFileSync(TRANSCRIPT, "");

const C = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function log(...parts: unknown[]): void {
  const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  process.stdout.write(line + "\n");
  appendFileSync(TRANSCRIPT, line.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
}

function box(title: string): void {
  const bar = "═".repeat(72);
  log("");
  log(`${C.cyan}╔${bar}╗${C.reset}`);
  log(`${C.cyan}║${C.reset}  ${C.bold}${title.padEnd(70)}${C.reset}${C.cyan}║${C.reset}`);
  log(`${C.cyan}╚${bar}╝${C.reset}`);
}

function recordTx(step: string, description: string, tx: Hex): void {
  arbiscanLinks.push({step, description, tx});
  log(`  ${C.dim}↪${C.reset} ${C.cyan}${ARB_SCAN}/tx/${tx}${C.reset}`);
}

const rl = readline.createInterface({input: stdin, output: stdout});

function pause(prompt = "Press Enter to continue"): Promise<void> {
  if (NON_INTERACTIVE) {
    log(`${C.dim}━━ ${prompt} (auto-skipped: --non-interactive) ━━${C.reset}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    rl.question(`\n${C.yellow}━━ ${prompt} ━━${C.reset} `).then(() => resolve());
  });
}

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main(): Promise<void> {
  if (!stdin.isTTY && !NON_INTERACTIVE) {
    throw new Error("verify-f7 must be run from a TTY or with --non-interactive.");
  }

  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account});

  const dep = JSON.parse(readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8")) as {
    contracts: {TestUSDC: Address; Faucet?: Address};
  };
  if (!dep.contracts.Faucet) throw new Error("Faucet not in deployments — run deploy:faucet first");
  const faucet = dep.contracts.Faucet;
  const tusdc = dep.contracts.TestUSDC;

  box("F7 VERIFICATION — FAUCET");
  log("");
  log(`  Deployer: ${account.address}`);
  log(`  Faucet:   ${faucet}`);
  log(`  TestUSDC: ${tusdc}`);

  // Step 2 — block + chain connectivity.
  const block = await pub.getBlockNumber();
  log(`  Block:    ${block}`);
  await pause();

  // Step 3 — Faucet balance ≥ 10M.
  box("STEP 3 — Faucet TestUSDC balance ≥ 10M");
  const faucetBal = (await pub.readContract({
    address: tusdc,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [faucet],
  })) as bigint;
  log(`  Faucet TestUSDC balance: ${formatUnits(faucetBal, 6)}`);
  if (faucetBal < FAUCET_FUNDING_FLOOR) {
    throw new Error(`Faucet balance ${faucetBal} < required ${FAUCET_FUNDING_FLOOR}`);
  }
  log(`  ${C.green}✓${C.reset} ≥ ${formatUnits(FAUCET_FUNDING_FLOOR, 6)}`);
  await pause();

  // Step 4 — pre-claim balance.
  box("STEP 4 — Pre-claim deployer balance");
  const preBal = (await pub.readContract({
    address: tusdc,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  log(`  Deployer TestUSDC pre-claim: ${formatUnits(preBal, 6)}`);

  // Cooldown gate — abort early on cooldown so we don't broadcast a doomed tx.
  const cooldownTs = (await pub.readContract({
    address: faucet,
    abi: FAUCET_ABI,
    functionName: "claimableAt",
    args: [account.address],
  })) as bigint;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (cooldownTs > nowSec) {
    const wait = Number(cooldownTs - nowSec);
    const hh = Math.floor(wait / 3600);
    const mm = Math.floor((wait % 3600) / 60);
    log(`  ${C.yellow}!!${C.reset} Deployer is on cooldown for ${hh}h ${mm}m more.`);
    log(`  Skipping claim. Re-run after cooldown lifts.`);
    rl.close();
    return;
  }
  await pause();

  // Step 5 — claim.
  box("STEP 5 — Claim 1000 TestUSDC from Faucet");
  const {request} = await pub.simulateContract({
    address: faucet,
    abi: FAUCET_ABI,
    functionName: "claim",
    account,
  });
  const claimTx = await wc.writeContract(request);
  log(`  Claim tx submitted: ${claimTx}`);
  recordTx("STEP 5", "Faucet.claim()", claimTx);
  const rc = await pub.waitForTransactionReceipt({hash: claimTx});
  if (rc.status !== "success") throw new Error(`Faucet.claim() reverted: ${claimTx}`);
  log(`  ${C.green}✓${C.reset} Claim confirmed`);
  await pause();

  // Step 6 — post-claim balance, assert delta.
  box("STEP 6 — Post-claim balance, assert delta == 1000");
  const postBal = (await pub.readContract({
    address: tusdc,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  log(`  Deployer TestUSDC post-claim: ${formatUnits(postBal, 6)}`);
  const delta = postBal - preBal;
  log(`  Delta: ${formatUnits(delta, 6)}`);
  if (delta !== CLAIM_AMOUNT) {
    throw new Error(`Delta ${delta} != expected ${CLAIM_AMOUNT}`);
  }
  log(`  ${C.green}✓${C.reset} delta == 1000 TestUSDC`);
  await pause();

  // Step 7 — claimableAt is now in the future.
  box("STEP 7 — claimableAt(deployer) in future");
  const newCooldownTs = (await pub.readContract({
    address: faucet,
    abi: FAUCET_ABI,
    functionName: "claimableAt",
    args: [account.address],
  })) as bigint;
  const nowAfter = BigInt(Math.floor(Date.now() / 1000));
  log(`  claimableAt: ${newCooldownTs} (Δ ${(newCooldownTs - nowAfter).toString()}s from now)`);
  if (newCooldownTs <= nowAfter) {
    throw new Error(`claimableAt ${newCooldownTs} not in future (now ${nowAfter})`);
  }
  log(`  ${C.green}✓${C.reset} cooldown active`);

  // ---- Summary ----
  box("F7 VERIFICATION COMPLETE");
  log("");
  log(`  ${C.bold}Test wallet${C.reset}`);
  log(`    pre-claim TestUSDC:  ${formatUnits(preBal, 6)}`);
  log(`    post-claim TestUSDC: ${formatUnits(postBal, 6)}`);
  log(`    delta:               ${formatUnits(delta, 6)}`);
  log(`  ${C.bold}Faucet${C.reset}`);
  log(
    `    balance after:       ${formatUnits(faucetBal - delta, 6)} (approx; another claim could have landed)`,
  );
  log(`    next claim for deployer in: ${(newCooldownTs - nowAfter).toString()}s`);
  log(`  ${C.bold}Run${C.reset}`);
  log(`    elapsed:             ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log("");

  const linksMd = [
    "# verify-f7 Arbiscan links",
    "",
    `Run: \`${stamp}\``,
    `Test wallet: \`${account.address}\``,
    `Faucet: \`${faucet}\``,
    "",
    "| # | Step | Description | Tx |",
    "| - | ---- | ----------- | -- |",
    ...arbiscanLinks.map(
      (r, i) =>
        `| ${i + 1} | ${r.step} | ${r.description} | [${r.tx.slice(0, 12)}…](${ARB_SCAN}/tx/${r.tx}) |`,
    ),
    "",
  ].join("\n");
  writeFileSync(`${OUTDIR}/arbiscan-links.md`, linksMd);

  writeFileSync(
    `${OUTDIR}/final-balances.json`,
    JSON.stringify(
      {
        runStartedAt: runStartedAt.toISOString(),
        wallet: account.address,
        faucet,
        balances: {
          preClaim: preBal.toString(),
          postClaim: postBal.toString(),
          delta: delta.toString(),
        },
        claimableAt: newCooldownTs.toString(),
        elapsedMs: Date.now() - t0,
      },
      null,
      2,
    ),
  );

  log(`${C.green}F7 backend verified.${C.reset}`);
  rl.close();
}

main().catch((e) => {
  process.stdout.write(`\n${C.red}[verify-f7] FAILED:${C.reset} ${e instanceof Error ? e.stack : e}\n`);
  appendFileSync(TRANSCRIPT, `\n[FAILED] ${e instanceof Error ? e.stack : e}\n`);
  rl.close();
  process.exit(1);
});

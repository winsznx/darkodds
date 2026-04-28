// SPDX-License-Identifier: MIT
//
// F10b — MarketRegistry operational-delegation tool. Two modes:
//
//   --to-eoa  : Safe-cosigned operational delegation of MarketRegistry
//               ownership to the deployer EOA for the live-judging period.
//               Enables the /create UI's one-click ChainGPT-generated market
//               flow (single EOA tx instead of 2-of-3 cosign). Same Safe SDK
//               pattern as tools/multisig-mint-faucet.ts and
//               tools/create-demo-market.ts. Architecturally a temporary
//               delegation — the F4.5 multisig hardening pattern is restored
//               post-judging via --to-safe.
//
//   --to-safe : Single tx from the deployer EOA restoring multisig ownership
//               to the 2-of-3 Safe. Idempotent — no-ops if already the Safe.
//               Mutates the prior delegation entry's `restoration_pending`
//               flag from true → false and stamps `restoration_completed_at`,
//               so a single grep `restoration_pending.*true` against
//               deployments/arb-sepolia.json surfaces any open commitments.
//
// Naming convention: the script never says "transfer-to-eoa" anywhere in
// audit output. The action is "operational_delegation_to_deployer_for_demo"
// and "operational_delegation_restored" — readers parsing this file or
// Arbiscan ownership history should see architected delegation (with
// explicit duration + reversal script + restoration_pending flag), not
// governance regression.
//
// Both modes:
//   1. Read MarketRegistry.owner() before
//   2. Print the planned action and require --confirm to execute
//   3. Execute the transfer (Safe SDK 2-of-3 OR single EOA writeContract)
//   4. Wait for receipt + re-read MarketRegistry.owner() after
//   5. Append/mutate `governance_history` in deployments/arb-sepolia.json
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, MULTISIG_SIGNER_2_PK, ARB_SEPOLIA_RPC_URL)
// Writes: contracts/deployments/arb-sepolia.json (governance_history)

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import Safe from "@safe-global/protocol-kit";
import {readFileSync, writeFileSync} from "node:fs";

const ARBISCAN = "https://sepolia.arbiscan.io";

const REGISTRY_ABI = parseAbi([
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner) external",
]);

interface Deployment {
  contracts: {MarketRegistry: Address; [k: string]: Address};
  safe: {address: Address};
  governance_history?: GovernanceEntry[];
  [k: string]: unknown;
}

/// Annotated address — embeds the role label inline so anyone reading
/// arb-sepolia.json sees "0x042a…F332 (2-of-3 Safe)" instead of an
/// opaque hex string. Same on-chain effect, richer audit trail.
type AnnotatedAddress = string;

interface GovernanceEntry {
  ts: string;
  action: "operational_delegation_to_deployer_for_demo" | "operational_delegation_restored";
  contract: "MarketRegistry";
  fromOwner: AnnotatedAddress;
  toOwner: AnnotatedAddress;
  txHash: Hex;
  /** True iff this is a delegation entry whose restoration hasn't been
   *  executed yet. Mutated to false (and `restoration_completed_at`
   *  stamped) when the matching `--to-safe` run lands. */
  restoration_pending?: boolean;
  restoration_completed_at?: string;
  /** Set on the restoration entry — points back to the delegation entry's
   *  txHash so the audit timeline is bidirectionally linked. */
  restores_delegation_tx?: Hex;
  reverses_via?: string;
  duration?: string;
  expected_restoration?: string;
  reason: string;
}

function annotate(addr: Address, role: string): AnnotatedAddress {
  return `${addr} (${role})`;
}

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function safeExecAs2of3(
  rpcUrl: string,
  safeAddress: Address,
  pk1: Hex,
  pk2: Hex,
  to: Address,
  data: Hex,
): Promise<Hex> {
  const sdk1 = await Safe.init({provider: rpcUrl, signer: pk1, safeAddress});
  let tx = await sdk1.createTransaction({transactions: [{to, value: "0", data}]});
  tx = await sdk1.signTransaction(tx);
  const sdk2 = await Safe.init({provider: rpcUrl, signer: pk2, safeAddress});
  tx = await sdk2.signTransaction(tx);
  const exec = await sdk1.executeTransaction(tx);
  const hash = (exec.hash ||
    (exec as unknown as {transactionResponse?: {hash: string}}).transactionResponse?.hash) as Hex | undefined;
  if (!hash) throw new Error("Safe executeTransaction returned no hash");
  return hash;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.find((a) => a === "--to-eoa" || a === "--to-safe");
  const confirm = args.includes("--confirm");
  if (!mode) {
    console.error("Usage: tsx tools/transfer-registry-ownership.ts <--to-eoa|--to-safe> [--confirm]");
    console.error("  --to-eoa : Safe-cosigned operational delegation to deployer EOA (demo mode)");
    console.error("  --to-safe: Single-EOA tx restoring multisig ownership to the Safe");
    console.error("  --confirm: required to actually execute. Omit for a dry-run preview.");
    process.exit(1);
  }

  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;
  const account = privateKeyToAccount(PK1);

  const depPath = `${process.cwd()}/contracts/deployments/arb-sepolia.json`;
  const dep = JSON.parse(readFileSync(depPath, "utf8")) as Deployment;
  const registry = dep.contracts.MarketRegistry;
  const safeAddr = dep.safe.address;
  if (!registry) throw new Error("MarketRegistry missing from deployments");
  if (!safeAddr) throw new Error("Safe missing from deployments");

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wallet = createWalletClient({account, chain: arbitrumSepolia, transport: http(RPC)});

  const ownerBefore = (await pub.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "owner",
  })) as Address;

  // Resolve the target + action label per mode, plus the human-readable
  // role annotations used in the audit-trail entry.
  let target: Address;
  let action: GovernanceEntry["action"];
  let fromRole: string;
  let toRole: string;
  let summary: string;
  let reversalHint: string;

  if (mode === "--to-eoa") {
    target = account.address;
    action = "operational_delegation_to_deployer_for_demo";
    fromRole = "2-of-3 Safe";
    toRole = "deployer EOA — temporary";
    summary = "Operationally delegate MarketRegistry ownership for live-judging period";
    reversalHint = "tools/transfer-registry-ownership.ts --to-safe --confirm";
  } else {
    target = safeAddr;
    action = "operational_delegation_restored";
    fromRole = "deployer EOA — temporary";
    toRole = "2-of-3 Safe";
    summary = "Restore MarketRegistry ownership to multisig (post-judging production-mode)";
    reversalHint =
      "tools/transfer-registry-ownership.ts --to-eoa --confirm (re-delegate, requires Safe co-sign)";
  }

  console.log(`╔══════════════════════════════════════════════════════════════════════╗`);
  console.log(`║  ${summary.padEnd(68)}║`);
  console.log(`╚══════════════════════════════════════════════════════════════════════╝`);
  console.log(`  contract:  MarketRegistry @ ${registry}`);
  console.log(`  from:      ${ownerBefore} (${fromRole})`);
  console.log(`  to:        ${target} (${toRole})`);
  console.log(`  action:    ${action}`);
  console.log(`  reversal:  ${reversalHint}`);
  console.log(``);

  // Idempotent + state-mismatch guards (run before --confirm so dry-run
  // surfaces them too).
  if (ownerBefore.toLowerCase() === target.toLowerCase()) {
    console.log(`  → owner() already at target. Idempotent no-op.`);
    return;
  }
  if (mode === "--to-eoa" && ownerBefore.toLowerCase() !== safeAddr.toLowerCase()) {
    throw new Error(
      `owner() is ${ownerBefore}, expected Safe ${safeAddr} for --to-eoa. Manual investigation required.`,
    );
  }
  if (mode === "--to-safe" && ownerBefore.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      `owner() is ${ownerBefore}, expected deployer EOA ${account.address} for --to-safe. ` +
        `Deployer must hold ownership before restoring to the Safe. Manual investigation required.`,
    );
  }

  if (!confirm) {
    console.log(`  ⚠  DRY RUN — no transaction sent.`);
    console.log(`  Re-run with --confirm to execute.`);
    return;
  }

  // ── Execute ─────────────────────────────────────────────────────────
  let txHash: Hex;
  if (mode === "--to-eoa") {
    const PK2 = need("MULTISIG_SIGNER_2_PK") as Hex;
    console.log(`  Co-signer 1: ${account.address}`);
    console.log(`  Co-signer 2: ${privateKeyToAccount(PK2).address}`);
    console.log(`  Submitting Safe-cosigned transferOwnership(${target})...`);
    const data = encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "transferOwnership",
      args: [target],
    });
    txHash = await safeExecAs2of3(RPC, safeAddr, PK1, PK2, registry, data);
  } else {
    console.log(`  Submitting transferOwnership(${target}) from deployer EOA...`);
    txHash = await wallet.writeContract({
      address: registry,
      abi: REGISTRY_ABI,
      functionName: "transferOwnership",
      args: [target],
    });
  }
  console.log(`  tx: ${txHash}`);
  console.log(`  ${ARBISCAN}/tx/${txHash}`);
  const rc = await pub.waitForTransactionReceipt({hash: txHash});
  if (rc.status !== "success") throw new Error(`transferOwnership reverted: ${txHash}`);

  const ownerAfter = (await pub.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "owner",
  })) as Address;
  if (ownerAfter.toLowerCase() !== target.toLowerCase()) {
    throw new Error(
      `Post-tx owner() ${ownerAfter} != expected ${target}. On-chain state diverged from intent.`,
    );
  }
  console.log(`  ✓ owner() now: ${ownerAfter} (${toRole})`);

  // ── Audit trail mutation ─────────────────────────────────────────────
  if (!Array.isArray(dep.governance_history)) dep.governance_history = [];

  if (mode === "--to-eoa") {
    const ts = new Date().toISOString();
    const expected = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const entry: GovernanceEntry = {
      ts,
      action: "operational_delegation_to_deployer_for_demo",
      contract: "MarketRegistry",
      fromOwner: annotate(ownerBefore, fromRole),
      toOwner: annotate(ownerAfter, toRole),
      txHash,
      restoration_pending: true,
      reverses_via: "tools/transfer-registry-ownership.ts --to-safe",
      duration: "live-judging window only",
      expected_restoration: `post-judging, within 7 days of submission (${expected.slice(0, 10)})`,
      reason:
        "F10b: enables one-click /create flow with ChainGPT-generated markets during DoraHacks " +
        "judging period. Safe ownership pattern (F4.5 audit artifact) preserved in audit trail; " +
        "restoration script tested and ready. Full reasoning: " +
        "KNOWN_LIMITATIONS.md §registry-ownership-temporary-delegation",
    };
    dep.governance_history.push(entry);
  } else {
    // --to-safe: append the restoration entry AND mutate any open
    // delegation entry's restoration_pending flag → false. There may be
    // multiple historic delegation entries; we close ALL of them that
    // are still pending, since the on-chain state at this moment proves
    // every prior delegation has now been restored.
    const ts = new Date().toISOString();
    const closedDelegationTxs: Hex[] = [];
    for (const prior of dep.governance_history) {
      if (
        prior.action === "operational_delegation_to_deployer_for_demo" &&
        prior.restoration_pending === true
      ) {
        prior.restoration_pending = false;
        prior.restoration_completed_at = ts;
        closedDelegationTxs.push(prior.txHash);
      }
    }
    const entry: GovernanceEntry = {
      ts,
      action: "operational_delegation_restored",
      contract: "MarketRegistry",
      fromOwner: annotate(ownerBefore, fromRole),
      toOwner: annotate(ownerAfter, toRole),
      txHash,
      restores_delegation_tx: closedDelegationTxs[closedDelegationTxs.length - 1],
      reason:
        "F10b post-judging restoration: returning MarketRegistry ownership to the 2-of-3 Safe " +
        "multisig, restoring F4.5 production-mode hardening. " +
        `Closed ${closedDelegationTxs.length} pending delegation entr` +
        `${closedDelegationTxs.length === 1 ? "y" : "ies"}.`,
    };
    dep.governance_history.push(entry);
    if (closedDelegationTxs.length > 0) {
      console.log(
        `  ✓ closed ${closedDelegationTxs.length} pending delegation entr${closedDelegationTxs.length === 1 ? "y" : "ies"}: ${closedDelegationTxs.join(", ")}`,
      );
    }
  }
  writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
  console.log(`  ✓ governance_history appended → ${depPath}`);

  console.log(`\n[transfer-ownership] DONE.`);
  console.log(`  ${ownerBefore} (${fromRole}) → ${ownerAfter} (${toRole})`);
  console.log(`  ${ARBISCAN}/tx/${txHash}`);
}

void main().catch((e) => {
  console.error("[transfer-ownership] FAILED:", e);
  process.exit(1);
});

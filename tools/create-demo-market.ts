// SPDX-License-Identifier: MIT
//
// F9-followup — Safe-cosigned demo market creation.
//
// Creates a real Open-state market ("Will BTC close above $100,000 by end of
// 2026?") wired to PreResolvedOracle so we can exercise the F9 bet flow on a
// presentable market and double as the F12-HOOK plaintext-odds screenshot
// bait at HALT 4.
//
// Three Safe-cosigned txs in sequence, same canonical pattern as
// tools/multisig-mint-faucet.ts:
//   1. MarketRegistry.createMarket(question, criteria, oracleType=2, expiry, feeBps)
//   2. PreResolvedOracle.configure(marketId, YES)
//   3. ResolutionOracle.setAdapter(marketId, PreResolvedOracle)
//
// Outputs the new market id + address; appends a deployments.json note for the
// audit trail.

import {
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import Safe from "@safe-global/protocol-kit";
import {readFileSync, writeFileSync} from "node:fs";

const ARBISCAN = "https://sepolia.arbiscan.io";

const REGISTRY_ABI = parseAbi([
  "function createMarket(string question, string resolutionCriteria, uint8 oracleType, uint256 expiryTs, uint256 protocolFeeBps) external returns (uint256 id, address market)",
  "function nextMarketId() view returns (uint256)",
  "event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs)",
]);
const PRE_ORACLE_ABI = parseAbi(["function configure(uint256 marketId, uint8 outcome) external"]);
const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);

const QUESTION = "Will BTC close above $100,000 by end of 2026?";
const RESOLUTION_CRITERIA =
  "Resolves YES if BTC/USD spot price ≥ $100,000.00 on the final daily close of 2026-12-31 UTC, sourced from Coinbase. Otherwise NO.";
const ORACLE_TYPE_PRE_RESOLVED = 2;
// 2026-12-31T23:59:59 UTC
const EXPIRY_TS = BigInt(Math.floor(Date.UTC(2026, 11, 31, 23, 59, 59) / 1000));
const PROTOCOL_FEE_BPS = BigInt(200); // 2%
const SEED_OUTCOME_YES = 1;

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
  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;
  const PK2 = need("MULTISIG_SIGNER_2_PK") as Hex;

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});

  const depPath = `${process.cwd()}/contracts/deployments/arb-sepolia.json`;
  const dep = JSON.parse(readFileSync(depPath, "utf8")) as {
    contracts: Record<string, Hex>;
    safe: {address: Address};
    notes?: Record<string, string>;
  };
  const safeAddr = dep.safe.address;
  const registryAddr = dep.contracts.MarketRegistry;
  const preOracleAddr = dep.contracts.PreResolvedOracle;
  const resOracleAddr = dep.contracts.ResolutionOracle;
  if (!registryAddr || !preOracleAddr || !resOracleAddr) {
    throw new Error("MarketRegistry / PreResolvedOracle / ResolutionOracle missing from deployments");
  }

  console.log(`[demo-market] Co-signers:`);
  console.log(`  PK1: ${account.address}`);
  console.log(`  PK2: ${privateKeyToAccount(PK2).address}`);
  console.log(`[demo-market] Safe:     ${safeAddr}`);
  console.log(`[demo-market] Registry: ${registryAddr}`);
  console.log(`[demo-market] PreOracle: ${preOracleAddr}`);
  console.log(`[demo-market] Question: "${QUESTION}"`);
  console.log(`[demo-market] Expiry:   ${new Date(Number(EXPIRY_TS) * 1000).toISOString()}`);

  const nextId = (await pub.readContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  console.log(`[demo-market] Next market id will be: ${nextId.toString()}`);

  // ─── 1. Safe-cosigned createMarket ───────────────────────────────────
  console.log(`\n[demo-market] Step 1/3: Safe-cosigned createMarket...`);
  const createData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "createMarket",
    args: [QUESTION, RESOLUTION_CRITERIA, ORACLE_TYPE_PRE_RESOLVED, EXPIRY_TS, PROTOCOL_FEE_BPS],
  });
  const createTx = await safeExecAs2of3(RPC, safeAddr, PK1, PK2, registryAddr, createData);
  console.log(`  createTx: ${createTx}`);
  console.log(`  ${ARBISCAN}/tx/${createTx}`);
  const createRc = await pub.waitForTransactionReceipt({hash: createTx});
  if (createRc.status !== "success") throw new Error(`createMarket reverted: ${createTx}`);

  let marketId = BigInt(0);
  let marketAddress: Address = "0x0000000000000000000000000000000000000000";
  for (const log of createRc.logs) {
    if (log.address.toLowerCase() !== registryAddr.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({abi: REGISTRY_ABI, data: log.data, topics: log.topics});
      if (decoded.eventName === "MarketCreated") {
        const a = decoded.args as {id: bigint; market: Address};
        marketId = a.id;
        marketAddress = a.market;
        break;
      }
    } catch {
      /* not this log */
    }
  }
  if (marketId === BigInt(0)) throw new Error("MarketCreated event not found in receipt");
  console.log(`  ✓ Market[${marketId}] at ${marketAddress}`);

  // ─── 2. Safe-cosigned PreResolvedOracle.configure ────────────────────
  console.log(`\n[demo-market] Step 2/3: configure PreResolvedOracle (outcome=YES)...`);
  const configureData = encodeFunctionData({
    abi: PRE_ORACLE_ABI,
    functionName: "configure",
    args: [marketId, SEED_OUTCOME_YES],
  });
  const configureTx = await safeExecAs2of3(RPC, safeAddr, PK1, PK2, preOracleAddr, configureData);
  console.log(`  configureTx: ${configureTx}`);
  console.log(`  ${ARBISCAN}/tx/${configureTx}`);
  await pub.waitForTransactionReceipt({hash: configureTx});

  // ─── 3. Safe-cosigned ResolutionOracle.setAdapter ────────────────────
  console.log(`\n[demo-market] Step 3/3: ResolutionOracle.setAdapter(${marketId}, PreOracle)...`);
  const setAdapterData = encodeFunctionData({
    abi: RES_ORACLE_ABI,
    functionName: "setAdapter",
    args: [marketId, preOracleAddr],
  });
  const setAdapterTx = await safeExecAs2of3(RPC, safeAddr, PK1, PK2, resOracleAddr, setAdapterData);
  console.log(`  setAdapterTx: ${setAdapterTx}`);
  console.log(`  ${ARBISCAN}/tx/${setAdapterTx}`);
  await pub.waitForTransactionReceipt({hash: setAdapterTx});

  // ─── Persist for audit trail ─────────────────────────────────────────
  dep.notes = dep.notes ?? {};
  dep.notes[`f9_demo_market_${marketId}_create_tx`] = createTx;
  dep.notes[`f9_demo_market_${marketId}_address`] = marketAddress;
  writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");

  console.log(`\n[demo-market] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[demo-market] Market[${marketId}]: ${marketAddress}`);
  console.log(`[demo-market] ${ARBISCAN}/address/${marketAddress}`);
  console.log(`[demo-market] Frontend: http://localhost:3000/markets/${marketId}`);
}

main().catch((e) => {
  console.error("[demo-market] FAILED:", e);
  process.exit(1);
});

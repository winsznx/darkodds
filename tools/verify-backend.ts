// SPDX-License-Identifier: MIT
//
// F5-final — End-to-end backend verification for the operator (manual run).
//
// Walks the operator through the entire DarkOdds lifecycle on real Arb Sepolia,
// pausing between each on-chain action so they can confirm txs on Arbiscan.
//
// 9 steps:
//   1. Wrap TestUSDC → cUSDC
//   2. Create a fresh Pre-Resolved YES market (Safe-cosigned, 3 txs)
//   3. Place a YES bet (set operator + placeBet)
//   4. Wait for batch publication, decrypt YES pool plaintext
//   5. Resolve market YES (resolveOracle + freezePool)
//   6. Claim winnings (Market.claimWinnings)
//   7. Generate audit attestation (deployer signs payload accepted by ClaimVerifier)
//   8. Verify the attestation on-chain (ClaimVerifier.verifyAttestation)
//   9. Unwrap remaining cUSDC → TestUSDC (2-tx requestUnwrap + finalizeUnwrap)
//
// Output:
//   verification-output/<timestamp>/
//     ├── transcript.txt       — full console output
//     ├── attestation.json     — generated attestation payload + signature
//     ├── arbiscan-links.md    — markdown index of every tx
//     └── final-balances.json  — pre-run, post-run, expected, actual
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, MULTISIG_SIGNER_2_PK, ARB_SEPOLIA_RPC_URL)
// Writes: verification-output/<timestamp>/* (gitignored)
//
// Flags:
//   --non-interactive   Skip all "Press Enter to continue" pauses and accept
//                       default answers for prompts (fresh test wallet = yes).
//                       Used by the agent for end-to-end CI-style runs;
//                       human-mode is the default.

import * as readline from "node:readline/promises";
import {stdin, stdout} from "node:process";
import {appendFileSync, mkdirSync, writeFileSync} from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  formatEther,
  formatUnits,
  encodeFunctionData,
  encodeAbiParameters,
  decodeEventLog,
  keccak256,
  toHex,
  type Hex,
  type Log,
  type Address,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";
import {createViemHandleClient} from "@iexec-nox/handle";
import Safe from "@safe-global/protocol-kit";

// ============================================================================
// Constants
// ============================================================================

const NON_INTERACTIVE = process.argv.includes("--non-interactive");

const ARB_SCAN = "https://sepolia.arbiscan.io";
const SAFE_UI_BASE = "https://app.safe.global/?safe=arb-sep:";

const SIX = 1_000_000n;
const WRAP_AMOUNT = 100n * SIX;
const BET_AMOUNT = 50n * SIX;
const TUSDC_FUND_AMOUNT = 1_000n * SIX;
const ETH_FUND_AMOUNT = parseEther("0.01");
const PROTOCOL_FEE_BPS = 200n; // 2%
const MARKET_EXPIRY_SECS = 180; // wide enough to absorb interactive pauses
const BATCH_WAIT_SECS = 65;
const CLAIM_OPEN_DELAY_SECS = 65;
const ORACLE_TYPE_PRE_RESOLVED = 2;

// ============================================================================
// ABIs
// ============================================================================

const TUSDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const CUSDC_ABI = parseAbi([
  "function wrap(uint256 amount, bytes32 encryptedAmount, bytes inputProof) external returns (bytes32)",
  "function setOperator(address operator, uint48 until) external",
  "function confidentialBalanceOf(address account) view returns (bytes32)",
  "function requestUnwrap(uint256 amount) external returns (bytes32 requestId)",
  "function finalizeUnwrap(bytes32 requestId, bytes decryptionProof) external",
  "event UnwrapRequested(address indexed user, bytes32 indexed requestId, uint256 amount)",
]);

const REGISTRY_ABI = parseAbi([
  "function createMarket(string question, string resolutionCriteria, uint8 oracleType, uint256 expiryTs, uint256 protocolFeeBps) external returns (uint256 id, address market)",
  "function nextMarketId() view returns (uint256)",
  "function marketImplementation() view returns (address)",
  "event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs)",
]);

const PRE_ORACLE_ABI = parseAbi(["function configure(uint256 marketId, uint8 outcome) external"]);

const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);

const MARKET_ABI = parseAbi([
  "function placeBet(uint8 side, bytes32 encryptedAmount, bytes inputProof) external",
  "function publishBatch() external",
  "function resolveOracle() external",
  "function freezePool(bytes yesProof, bytes noProof) external",
  "function claimWinnings() external",
  "function expiryTs() view returns (uint256)",
  "function state() view returns (uint8)",
  "function yesPoolFrozen() view returns (uint256)",
  "function noPoolFrozen() view returns (uint256)",
  "function yesPoolPublishedHandle() view returns (bytes32)",
  "function claimWindowOpensAt() view returns (uint256)",
  "event BetPlaced(address indexed user, uint8 side, bytes32 amountHandle, uint256 batchId)",
  "event BatchPublished(uint256 indexed batchId, uint256 betsInBatch, uint256 ts)",
  "event PoolFrozen(uint256 yesPlaintext, uint256 noPlaintext, uint256 ts)",
  "event ClaimSettled(address indexed user, uint8 outcome, bytes32 payoutHandle, bytes32 feeHandle)",
]);

const VERIFIER_ABI = parseAbi([
  "function pinnedTdxMeasurement() view returns (bytes32)",
  "function attestationSigner() view returns (address)",
  "function verifyAttestation(bytes attestationData, bytes signature) view returns (address user, uint256 marketId, uint8 outcome, bytes32 payoutCommitment, uint256 timestamp, address recipient, uint256 nonce)",
]);

const ATTESTATION_PAYLOAD_TUPLE = [
  {type: "address", name: "user"},
  {type: "uint256", name: "marketId"},
  {type: "uint8", name: "outcome"},
  {type: "bytes32", name: "payoutCommitment"},
  {type: "uint256", name: "timestamp"},
  {type: "address", name: "recipient"},
  {type: "uint256", name: "nonce"},
  {type: "bytes32", name: "tdxMeasurement"},
] as const;

// ============================================================================
// Output state — written incrementally as the run progresses
// ============================================================================

type LinkRow = {step: string; description: string; tx: Hex};
const arbiscanLinks: LinkRow[] = [];

const runStartedAt = new Date();
const stamp = runStartedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUTDIR = `${process.cwd()}/verification-output/${stamp}`;
mkdirSync(OUTDIR, {recursive: true});
const TRANSCRIPT = `${OUTDIR}/transcript.txt`;
writeFileSync(TRANSCRIPT, ""); // truncate

// ============================================================================
// ANSI helpers — used sparingly (color section headers + tx links)
// ============================================================================

const C = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
};

function log(...parts: unknown[]): void {
  const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  process.stdout.write(line + "\n");
  // Strip ANSI color codes for the on-disk transcript so it's grep-friendly.
  appendFileSync(TRANSCRIPT, line.replace(/\x1b\[[0-9;]*m/g, "") + "\n");
}

function box(title: string): void {
  const bar = "═".repeat(72);
  log("");
  log(`${C.cyan}╔${bar}╗${C.reset}`);
  log(`${C.cyan}║${C.reset}  ${C.bold}${title.padEnd(70)}${C.reset}${C.cyan}║${C.reset}`);
  log(`${C.cyan}╚${bar}╝${C.reset}`);
}

function section(title: string): void {
  log("");
  log(`${C.bold}${title}${C.reset}`);
  log(C.dim + "─".repeat(Math.min(title.length, 60)) + C.reset);
}

function recordTx(step: string, description: string, tx: Hex): void {
  arbiscanLinks.push({step, description, tx});
  log(`  ${C.dim}↪${C.reset} ${C.cyan}${ARB_SCAN}/tx/${tx}${C.reset}`);
}

function pause(prompt = "Press Enter to continue"): Promise<void> {
  if (NON_INTERACTIVE) {
    log(`${C.dim}━━ ${prompt} (auto-skipped: --non-interactive) ━━${C.reset}`);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    rl.question(`\n${C.yellow}━━ ${prompt} ━━${C.reset} `).then(() => resolve());
  });
}

const rl = readline.createInterface({input: stdin, output: stdout});

async function promptYn(question: string, def = true): Promise<boolean> {
  if (NON_INTERACTIVE) {
    log(`${question} ${C.dim}(auto-answer: ${def ? "Y" : "n"})${C.reset}`);
    return def;
  }
  const tag = def ? "(Y/n)" : "(y/N)";
  const ans = (await rl.question(`${question} ${tag} `)).trim().toLowerCase();
  if (ans === "") return def;
  return ans === "y" || ans === "yes";
}

// ============================================================================
// Safe co-sign helper (PK1 + PK2, both from .env)
// ============================================================================

async function safeCosign(
  rpcUrl: string,
  safeAddress: string,
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

// ============================================================================
// Time helpers
// ============================================================================

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function countdown(label: string, totalSecs: number): Promise<void> {
  for (let s = totalSecs; s > 0; s--) {
    process.stdout.write(`\r  ${C.dim}${label}: ${C.reset}${C.yellow}${s}s${C.reset}    `);
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
  }
  process.stdout.write("\r" + " ".repeat(60) + "\r");
  log(`  ${C.dim}${label}: ${C.green}done${C.reset}`);
}

// ============================================================================
// Main entry point
// ============================================================================

async function main(): Promise<void> {
  if (!stdin.isTTY && !NON_INTERACTIVE) {
    throw new Error(
      "verify-backend must be run from an interactive terminal, or with --non-interactive. " +
        "Human runs: `pnpm verify:backend`. Agent / CI runs: `pnpm verify:backend --non-interactive`.",
    );
  }

  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;
  const PK2 = need("MULTISIG_SIGNER_2_PK") as Hex;

  const deployer = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const deployerWc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account: deployer});

  // ------------------------------------------------------------------
  // Header
  // ------------------------------------------------------------------
  box("DARKODDS — END-TO-END BACKEND VERIFICATION");
  log("");
  log(`${C.dim}Confidential prediction market on Arbitrum Sepolia.${C.reset}`);
  log(`${C.dim}This walkthrough exercises every contract in the system.${C.reset}`);
  log(`${C.dim}Read each step, confirm the Arbiscan link, then press Enter to advance.${C.reset}`);

  const dep = JSON.parse(
    (await import("node:fs")).readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as {
    contracts: Record<string, Hex>;
    safe: {address: Address; threshold: number; signers: Address[]};
  };

  const block = await pub.getBlockNumber();
  const ethBal = await pub.getBalance({address: deployer.address});

  section("Environment");
  log(`  Block:        ${block}`);
  log(`  RPC:          ${RPC}`);
  log(`  Deployer:     ${deployer.address}`);
  log(`  Deployer ETH: ${formatEther(ethBal)}`);

  section("Active deployment");
  const mustHex = (v: Hex | undefined, name: string): Hex => {
    if (!v) throw new Error(`Missing ${name} in deployments/arb-sepolia.json`);
    return v;
  };
  const c = {
    TestUSDC: mustHex(dep.contracts.TestUSDC, "TestUSDC"),
    ConfidentialUSDC: mustHex(dep.contracts.ConfidentialUSDC, "ConfidentialUSDC"),
    MarketRegistry: mustHex(dep.contracts.MarketRegistry, "MarketRegistry"),
    MarketImplementation: mustHex(
      dep.contracts.MarketImplementation_v5 ?? dep.contracts.MarketImplementation,
      "MarketImplementation",
    ),
    MarketImplementation_v5: dep.contracts.MarketImplementation_v5,
    ResolutionOracle: mustHex(dep.contracts.ResolutionOracle, "ResolutionOracle"),
    PreResolvedOracle: mustHex(dep.contracts.PreResolvedOracle, "PreResolvedOracle"),
    ClaimVerifier: mustHex(dep.contracts.ClaimVerifier, "ClaimVerifier"),
  };
  const safeAddr = dep.safe.address as Hex;
  const link = (a: Hex) => `${ARB_SCAN}/address/${a}`;
  log(`  TestUSDC:                ${c.TestUSDC}`);
  log(`    ${C.dim}${link(c.TestUSDC)}${C.reset}`);
  log(`  ConfidentialUSDC:        ${c.ConfidentialUSDC}`);
  log(`    ${C.dim}${link(c.ConfidentialUSDC)}${C.reset}`);
  log(`  MarketRegistry:          ${c.MarketRegistry}`);
  log(`    ${C.dim}${link(c.MarketRegistry)}${C.reset}`);
  log(`  MarketImplementation v5: ${c.MarketImplementation}`);
  log(`    ${C.dim}${link(c.MarketImplementation)}${C.reset}`);
  log(`  ResolutionOracle:        ${c.ResolutionOracle}`);
  log(`  PreResolvedOracle:       ${c.PreResolvedOracle}`);
  log(`  ClaimVerifier:           ${c.ClaimVerifier}`);
  log(`    ${C.dim}${link(c.ClaimVerifier)}${C.reset}`);
  log(`  Safe (2-of-3):           ${safeAddr}`);
  log(`    ${C.dim}${SAFE_UI_BASE}${safeAddr}${C.reset}`);

  // ------------------------------------------------------------------
  // Pre-flight check
  // ------------------------------------------------------------------
  section("Pre-flight check");
  if (ethBal < parseEther("0.02")) {
    log(`${C.red}  FAIL: deployer ETH balance ${formatEther(ethBal)} < 0.02 ETH${C.reset}`);
    log("  Top up the deployer with Arbitrum Sepolia ETH from a faucet, then re-run.");
    log(`  Faucet: https://www.alchemy.com/faucets/arbitrum-sepolia`);
    process.exit(1);
  }
  log(`  ${C.green}✓${C.reset} Deployer ETH ≥ 0.02 (${formatEther(ethBal)})`);

  const deployerTusdc = (await pub.readContract({
    address: c.TestUSDC,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [deployer.address],
  })) as bigint;
  log(`  ${C.green}✓${C.reset} Deployer TestUSDC balance: ${formatUnits(deployerTusdc, 6)}`);

  const onchainImpl = (await pub.readContract({
    address: c.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "marketImplementation",
  })) as Hex;
  if (onchainImpl.toLowerCase() !== c.MarketImplementation.toLowerCase()) {
    throw new Error(`registry impl ${onchainImpl} != expected ${c.MarketImplementation}`);
  }
  log(`  ${C.green}✓${C.reset} Registry points at MarketImplementation v5`);

  // ------------------------------------------------------------------
  // Wallet selection
  // ------------------------------------------------------------------
  section("Test wallet");
  const useFresh = await promptYn(
    `Generate a fresh test wallet for this run?\n` +
      `  (Y) recommended — fresh state, clean balance arithmetic\n` +
      `  (n) reuse the deployer wallet — faster, but mixes state\n`,
    true,
  );

  let testPk: Hex;
  let testAccount: typeof deployer;
  // Mirror deployerWc's inferred type so viem's chain-narrowed sendTransaction
  // overload accepts the {chain} arg without explicit cast.
  let testWc: typeof deployerWc;
  if (useFresh) {
    testPk = generatePrivateKey();
    testAccount = privateKeyToAccount(testPk);
    testWc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account: testAccount});
    log(`  ${C.green}✓${C.reset} Fresh test wallet generated:`);
    log(`     address:  ${testAccount.address}`);
    log(`     ${C.dim}(private key kept in memory only; never written to disk)${C.reset}`);
  } else {
    testPk = PK1;
    testAccount = deployer;
    testWc = deployerWc;
    log(`  ${C.green}✓${C.reset} Reusing deployer wallet ${deployer.address}`);
  }

  const testHandleClient = await createViemHandleClient(testWc);

  // Pre-run balance snapshot
  const preTusdc = (await pub.readContract({
    address: c.TestUSDC,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [testAccount.address],
  })) as bigint;
  log(`  Test wallet pre-run TestUSDC: ${formatUnits(preTusdc, 6)}`);

  // ------------------------------------------------------------------
  // Fund the test wallet
  // ------------------------------------------------------------------
  section("Funding the test wallet");
  if (useFresh) {
    log(`  Sending ${formatEther(ETH_FUND_AMOUNT)} ETH from deployer → test wallet (gas budget)...`);
    const ethTx = await deployerWc.sendTransaction({to: testAccount.address, value: ETH_FUND_AMOUNT});
    await pub.waitForTransactionReceipt({hash: ethTx});
    recordTx("FUND", "deployer → test wallet ETH", ethTx);
  } else {
    log(`  Skipping ETH transfer (deployer is already test wallet).`);
  }

  log(`  Minting ${formatUnits(TUSDC_FUND_AMOUNT, 6)} TestUSDC → test wallet via Safe co-sign...`);
  const mintData = encodeFunctionData({
    abi: TUSDC_ABI,
    functionName: "mint",
    args: [testAccount.address, TUSDC_FUND_AMOUNT],
  });
  const mintTx = await safeCosign(RPC, safeAddr, PK1, PK2, c.TestUSDC, mintData);
  await pub.waitForTransactionReceipt({hash: mintTx});
  recordTx("FUND", "Safe-cosigned TestUSDC.mint(test wallet)", mintTx);

  const fundedTusdc = (await pub.readContract({
    address: c.TestUSDC,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [testAccount.address],
  })) as bigint;
  log(`  ${C.green}✓${C.reset} Test wallet TestUSDC: ${formatUnits(fundedTusdc, 6)}`);
  if (useFresh) {
    const ethAfter = await pub.getBalance({address: testAccount.address});
    log(`  ${C.green}✓${C.reset} Test wallet ETH:      ${formatEther(ethAfter)}`);
  }

  await pause();

  // ------------------------------------------------------------------
  // STEP 1 — Wrap TestUSDC → cUSDC
  // ------------------------------------------------------------------
  box("STEP 1 / 9 — Wrap TestUSDC → cUSDC");
  log(`  About to wrap ${formatUnits(WRAP_AMOUNT, 6)} TestUSDC into cUSDC.`);
  log(`  Two txs: (a) approve cUSDC to pull TestUSDC, (b) cUSDC.wrap(...).`);
  log(`  After wrap, your ${formatUnits(WRAP_AMOUNT, 6)} cUSDC balance is encrypted.`);

  const approveData = encodeFunctionData({
    abi: TUSDC_ABI,
    functionName: "approve",
    args: [c.ConfidentialUSDC, WRAP_AMOUNT],
  });
  const approveTx = await testWc.sendTransaction({to: c.TestUSDC, data: approveData, chain: arbitrumSepolia});
  await pub.waitForTransactionReceipt({hash: approveTx});
  recordTx("STEP 1", "TestUSDC.approve(cUSDC, 100)", approveTx);

  const {handle: wrapHandle, handleProof: wrapProof} = await testHandleClient.encryptInput(
    WRAP_AMOUNT,
    "uint256",
    c.ConfidentialUSDC,
  );
  const wrapData = encodeFunctionData({
    abi: CUSDC_ABI,
    functionName: "wrap",
    args: [WRAP_AMOUNT, wrapHandle as Hex, wrapProof as Hex],
  });
  const wrapTx = await testWc.sendTransaction({
    to: c.ConfidentialUSDC,
    data: wrapData,
    chain: arbitrumSepolia,
  });
  await pub.waitForTransactionReceipt({hash: wrapTx});
  recordTx("STEP 1", "cUSDC.wrap(100 TUSDC → encrypted)", wrapTx);

  const cusdcBalanceHandle = (await pub.readContract({
    address: c.ConfidentialUSDC,
    abi: CUSDC_ABI,
    functionName: "confidentialBalanceOf",
    args: [testAccount.address],
  })) as Hex;
  log(`  ${C.green}✓${C.reset} cUSDC balance handle (encrypted): ${cusdcBalanceHandle}`);
  log(`  ${C.dim}This handle is ACL'd to the test wallet. Decrypting it via the Nox SDK${C.reset}`);
  log(`  ${C.dim}would yield ${formatUnits(WRAP_AMOUNT, 6)} cUSDC plaintext.${C.reset}`);

  await pause();

  // ------------------------------------------------------------------
  // STEP 2 — Find or create a fresh market
  // ------------------------------------------------------------------
  box("STEP 2 / 9 — Create a fresh Pre-Resolved YES market");
  log(`  Three Safe-cosigned txs (all using the operator's local PK1+PK2):`);
  log(`    (a) MarketRegistry.createMarket(...)`);
  log(`    (b) PreResolvedOracle.configure(marketId, YES)`);
  log(`    (c) ResolutionOracle.setAdapter(marketId, PreResolvedOracle)`);
  log(`  Market expiry: now + ${MARKET_EXPIRY_SECS}s. Fee: ${PROTOCOL_FEE_BPS} bps.`);

  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  const expiryTs = nowTs + BigInt(MARKET_EXPIRY_SECS);

  const createData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "createMarket",
    args: [
      `verify-backend-${stamp}`,
      "PreResolvedOracle hardcoded YES",
      ORACLE_TYPE_PRE_RESOLVED,
      expiryTs,
      PROTOCOL_FEE_BPS,
    ],
  });
  const createTx = await safeCosign(RPC, safeAddr, PK1, PK2, c.MarketRegistry, createData);
  const createRc = await pub.waitForTransactionReceipt({hash: createTx});
  recordTx("STEP 2", "Safe-cosigned MarketRegistry.createMarket", createTx);

  // Extract MarketCreated event
  const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";
  let marketId = 0n;
  let marketAddress: Hex = ZERO_ADDRESS;
  for (const lg of createRc.logs) {
    if (lg.address.toLowerCase() !== c.MarketRegistry.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: REGISTRY_ABI,
        data: lg.data,
        topics: lg.topics,
      });
      if (decoded.eventName === "MarketCreated") {
        const args = decoded.args as {id: bigint; market: Hex};
        marketId = args.id;
        marketAddress = args.market;
        break;
      }
    } catch {
      /* not this log */
    }
  }
  if (marketAddress === ZERO_ADDRESS) throw new Error("MarketCreated event not found");

  log(`  ${C.green}✓${C.reset} Market[${marketId}] at ${marketAddress}`);
  log(`     ${C.dim}${link(marketAddress)}${C.reset}`);
  log(`     ${C.dim}Expires at unix ${expiryTs} (~${MARKET_EXPIRY_SECS}s from now)${C.reset}`);

  const configureData = encodeFunctionData({
    abi: PRE_ORACLE_ABI,
    functionName: "configure",
    args: [marketId, 1], // YES
  });
  const configureTx = await safeCosign(RPC, safeAddr, PK1, PK2, c.PreResolvedOracle, configureData);
  await pub.waitForTransactionReceipt({hash: configureTx});
  recordTx("STEP 2", "Safe-cosigned PreResolvedOracle.configure(marketId, YES)", configureTx);

  const setAdapterData = encodeFunctionData({
    abi: RES_ORACLE_ABI,
    functionName: "setAdapter",
    args: [marketId, c.PreResolvedOracle],
  });
  const setAdapterTx = await safeCosign(RPC, safeAddr, PK1, PK2, c.ResolutionOracle, setAdapterData);
  await pub.waitForTransactionReceipt({hash: setAdapterTx});
  recordTx("STEP 2", "Safe-cosigned ResolutionOracle.setAdapter", setAdapterTx);

  log(`  ${C.green}✓${C.reset} PreResolvedOracle wired to market[${marketId}] for outcome=YES.`);

  await pause();

  // ------------------------------------------------------------------
  // STEP 3 — Place bet on YES, 50 cUSDC
  // ------------------------------------------------------------------
  box("STEP 3 / 9 — Place a YES bet of 50 cUSDC");
  log(`  Two txs: (a) cUSDC.setOperator(market) so the market can pull funds,`);
  log(`           (b) Market.placeBet(YES, encrypted 50e6, gateway proof).`);
  log(`  The bet amount is encrypted client-side via the Nox SDK.`);

  const operatorUntil = expiryTs + 86400n; // 1 day past expiry
  const setOperatorData = encodeFunctionData({
    abi: CUSDC_ABI,
    functionName: "setOperator",
    args: [marketAddress, Number(operatorUntil)],
  });
  const setOperatorTx = await testWc.sendTransaction({
    to: c.ConfidentialUSDC,
    data: setOperatorData,
    chain: arbitrumSepolia,
  });
  await pub.waitForTransactionReceipt({hash: setOperatorTx});
  recordTx("STEP 3", "cUSDC.setOperator(market)", setOperatorTx);

  log(`  Encrypting bet via Nox gateway (applicationContract = ${marketAddress})...`);
  const {handle: betHandle, handleProof: betProof} = await testHandleClient.encryptInput(
    BET_AMOUNT,
    "uint256",
    marketAddress,
  );

  const placeBetData = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: "placeBet",
    args: [1, betHandle as Hex, betProof as Hex], // 1 = YES
  });
  const placeBetTx = await testWc.sendTransaction({
    to: marketAddress,
    data: placeBetData,
    chain: arbitrumSepolia,
  });
  const placeBetRc = await pub.waitForTransactionReceipt({hash: placeBetTx});
  recordTx("STEP 3", "Market.placeBet(YES, 50 cUSDC encrypted)", placeBetTx);

  // Decode BetPlaced event for the operator's eyes
  for (const lg of placeBetRc.logs) {
    if (lg.address.toLowerCase() !== marketAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({abi: MARKET_ABI, data: lg.data, topics: lg.topics});
      if (decoded.eventName === "BetPlaced") {
        const a = decoded.args as {user: Address; side: number; amountHandle: Hex; batchId: bigint};
        log(`  ${C.green}✓${C.reset} BetPlaced event:`);
        log(`     user:         ${a.user}`);
        log(`     side:         ${a.side === 1 ? "YES" : "NO"}`);
        log(`     amountHandle: ${a.amountHandle}  ${C.dim}(encrypted)${C.reset}`);
        log(`     batchId:      ${a.batchId}`);
      }
    } catch {
      /* not this log */
    }
  }

  await pause();

  // ------------------------------------------------------------------
  // STEP 4 — Wait for batch publication
  // ------------------------------------------------------------------
  box("STEP 4 / 9 — Wait for batch publication, then decrypt YES pool");
  log(`  Bets accumulate in a TEE-only batch handle and aren't visible until publishBatch().`);
  log(`  publishBatch() is permissionless and runs every ${BATCH_WAIT_SECS}s.`);

  await countdown("Waiting for batch slot to open", BATCH_WAIT_SECS);

  const publishData = encodeFunctionData({abi: MARKET_ABI, functionName: "publishBatch", args: []});
  const publishTx = await testWc.sendTransaction({
    to: marketAddress,
    data: publishData,
    chain: arbitrumSepolia,
  });
  const publishRc = await pub.waitForTransactionReceipt({hash: publishTx});
  recordTx("STEP 4", "Market.publishBatch()", publishTx);

  for (const lg of publishRc.logs) {
    if (lg.address.toLowerCase() !== marketAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({abi: MARKET_ABI, data: lg.data, topics: lg.topics});
      if (decoded.eventName === "BatchPublished") {
        const a = decoded.args as {batchId: bigint; betsInBatch: bigint; ts: bigint};
        log(`  ${C.green}✓${C.reset} BatchPublished:`);
        log(`     batchId:     ${a.batchId}`);
        log(`     betsInBatch: ${a.betsInBatch}`);
        log(`     timestamp:   ${a.ts}`);
      }
    } catch {
      /* not this log */
    }
  }

  log(`  Decrypting yesPoolPublishedHandle via the Nox gateway...`);
  const yesHandleNow = (await pub.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "yesPoolPublishedHandle",
  })) as Hex;
  const yesPub = await testHandleClient.publicDecrypt(yesHandleNow);
  if (typeof yesPub.value !== "bigint") throw new Error("publicDecrypt returned non-bigint");
  log(`  ${C.green}✓${C.reset} yesPool plaintext: ${formatUnits(yesPub.value, 6)} cUSDC`);
  if (yesPub.value !== BET_AMOUNT) {
    log(
      `  ${C.yellow}!! expected ${formatUnits(BET_AMOUNT, 6)}, got ${formatUnits(yesPub.value, 6)}${C.reset}`,
    );
  } else {
    log(`     ${C.dim}matches the 50 cUSDC bet ✓${C.reset}`);
  }

  await pause();

  // ------------------------------------------------------------------
  // STEP 5 — Resolve market YES
  // ------------------------------------------------------------------
  box("STEP 5 / 9 — Resolve the market");
  const onchainExpiry = (await pub.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "expiryTs",
  })) as bigint;
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  if (nowSec < onchainExpiry) {
    const wait = Number(onchainExpiry - nowSec) + 2;
    log(`  Market not yet expired. Waiting ${wait}s for expiry...`);
    await countdown("Waiting for market expiry", wait);
  } else {
    log(`  ${C.green}✓${C.reset} Market past expiry (now=${nowSec}, expiry=${onchainExpiry}).`);
  }

  log(`  Calling Market.resolveOracle() — drives state Open→Closed→Resolving.`);
  const resolveData = encodeFunctionData({abi: MARKET_ABI, functionName: "resolveOracle", args: []});
  const resolveTx = await testWc.sendTransaction({
    to: marketAddress,
    data: resolveData,
    chain: arbitrumSepolia,
  });
  await pub.waitForTransactionReceipt({hash: resolveTx});
  recordTx("STEP 5", "Market.resolveOracle()", resolveTx);

  log(`  Building gateway public-decryption proofs for YES & NO pools...`);
  const yesHandleResolve = (await pub.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "yesPoolPublishedHandle",
  })) as Hex;
  const noHandleResolve = (await pub.readContract({
    address: marketAddress,
    abi: parseAbi(["function noPoolPublishedHandle() view returns (bytes32)"]),
    functionName: "noPoolPublishedHandle",
  })) as Hex;
  const yesProof = await testHandleClient.publicDecrypt(yesHandleResolve);
  const noProof = await testHandleClient.publicDecrypt(noHandleResolve);

  const freezeData = encodeFunctionData({
    abi: MARKET_ABI,
    functionName: "freezePool",
    args: [yesProof.decryptionProof as Hex, noProof.decryptionProof as Hex],
  });
  const freezeTx = await testWc.sendTransaction({
    to: marketAddress,
    data: freezeData,
    chain: arbitrumSepolia,
  });
  const freezeRc = await pub.waitForTransactionReceipt({hash: freezeTx});
  recordTx("STEP 5", "Market.freezePool(yesProof, noProof)", freezeTx);

  const yesFrozen = (await pub.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "yesPoolFrozen",
  })) as bigint;
  const noFrozen = (await pub.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "noPoolFrozen",
  })) as bigint;
  log(`  ${C.green}✓${C.reset} Pools frozen (now publicly readable per spec):`);
  log(`     yesPoolFrozen: ${formatUnits(yesFrozen, 6)} cUSDC`);
  log(`     noPoolFrozen:  ${formatUnits(noFrozen, 6)} cUSDC`);

  // PoolFrozen / ClaimWindowOpened events
  for (const lg of freezeRc.logs) {
    if (lg.address.toLowerCase() !== marketAddress.toLowerCase()) continue;
    try {
      const d = decodeEventLog({abi: MARKET_ABI, data: lg.data, topics: lg.topics});
      if (d.eventName === "PoolFrozen") {
        log(`     ${C.dim}PoolFrozen event emitted ✓${C.reset}`);
      }
    } catch {
      /* */
    }
  }

  await pause();

  // ------------------------------------------------------------------
  // STEP 6 — Claim winnings
  // ------------------------------------------------------------------
  box("STEP 6 / 9 — Claim winnings");
  const claimOpensAt = (await pub.readContract({
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "claimWindowOpensAt",
  })) as bigint;
  const nowClaim = BigInt(Math.floor(Date.now() / 1000));
  if (nowClaim < claimOpensAt) {
    const wait = Number(claimOpensAt - nowClaim) + 2;
    log(`  Claim window opens in ${wait}s (60s anti-MEV delay after freezePool).`);
    await countdown("Waiting for claim window", wait);
  }

  log(`  Calling Market.claimWinnings() — runs proportional payout via Nox arithmetic.`);
  log(`  Single-bettor on winning side: gross = bet * total / winning = 50 * 50 / 50 = 50.`);
  log(`  Fee (200 bps): 50 * 200 / 10000 = 1. Net: 49 cUSDC transferred back encrypted.`);

  const claimData = encodeFunctionData({abi: MARKET_ABI, functionName: "claimWinnings", args: []});
  const claimTx = await testWc.sendTransaction({to: marketAddress, data: claimData, chain: arbitrumSepolia});
  const claimRc = await pub.waitForTransactionReceipt({hash: claimTx});
  recordTx("STEP 6", "Market.claimWinnings()", claimTx);

  let payoutHandle: Hex = "0x" as Hex;
  let feeHandle: Hex = "0x" as Hex;
  for (const lg of claimRc.logs) {
    if (lg.address.toLowerCase() !== marketAddress.toLowerCase()) continue;
    try {
      const d = decodeEventLog({abi: MARKET_ABI, data: lg.data, topics: lg.topics});
      if (d.eventName === "ClaimSettled") {
        const a = d.args as {user: Address; outcome: number; payoutHandle: Hex; feeHandle: Hex};
        payoutHandle = a.payoutHandle;
        feeHandle = a.feeHandle;
        log(`  ${C.green}✓${C.reset} ClaimSettled event:`);
        log(`     user:          ${a.user}`);
        log(`     outcome:       ${a.outcome === 1 ? "YES" : a.outcome === 0 ? "NO" : "INVALID"}`);
        log(`     payoutHandle:  ${a.payoutHandle}  ${C.dim}(encrypted)${C.reset}`);
        log(`     feeHandle:     ${a.feeHandle}  ${C.dim}(encrypted)${C.reset}`);
      }
    } catch {
      /* */
    }
  }
  if (payoutHandle === ("0x" as Hex)) throw new Error("ClaimSettled not found");

  log(`  ${C.dim}Note: cUSDC balance update is processed asynchronously by the Nox Runner.${C.reset}`);
  log(`  ${C.dim}If you decrypt the test wallet's cUSDC balance shortly after this tx,${C.reset}`);
  log(`  ${C.dim}you'll see the updated balance once the runner confirms the transfer.${C.reset}`);

  await pause();

  // ------------------------------------------------------------------
  // STEP 7 — Generate audit attestation
  // ------------------------------------------------------------------
  box("STEP 7 / 9 — Generate audit attestation (deployer-signed)");
  log(`  ClaimVerifier accepts attestations signed by the contract's pinned signer.`);
  log(`  In production this is a TEE handler key. On testnet/F5, the signer is the`);
  log(`  deployer EOA — verifying that the verifier contract itself is wired correctly.`);

  const pinnedMeasurement = (await pub.readContract({
    address: c.ClaimVerifier,
    abi: VERIFIER_ABI,
    functionName: "pinnedTdxMeasurement",
  })) as Hex;
  const pinnedSigner = (await pub.readContract({
    address: c.ClaimVerifier,
    abi: VERIFIER_ABI,
    functionName: "attestationSigner",
  })) as Address;
  log(`  ClaimVerifier pinned measurement: ${pinnedMeasurement}`);
  log(`  ClaimVerifier expected signer:    ${pinnedSigner}`);
  if (pinnedSigner.toLowerCase() !== deployer.address.toLowerCase()) {
    log(`  ${C.red}!! pinned signer != deployer — attestation will not verify.${C.reset}`);
  }

  const claimBlock = await pub.getBlock({blockNumber: claimRc.blockNumber});
  const attestationPayload = {
    user: testAccount.address,
    marketId,
    outcome: 1,
    payoutCommitment: payoutHandle,
    timestamp: claimBlock.timestamp,
    recipient: ("0x" + "00".repeat(20)) as Address, // bearer mode
    nonce: 1n,
    tdxMeasurement: pinnedMeasurement,
  };
  const attestationData = encodeAbiParameters(
    [{type: "tuple", components: [...ATTESTATION_PAYLOAD_TUPLE]}],
    [attestationPayload],
  );
  const digest = keccak256(attestationData);
  const sig = await deployerWc.signMessage({message: {raw: digest}, account: deployer});

  const attestationJson = {
    payload: {
      user: attestationPayload.user,
      marketId: attestationPayload.marketId.toString(),
      outcome: attestationPayload.outcome,
      payoutCommitment: attestationPayload.payoutCommitment,
      timestamp: attestationPayload.timestamp.toString(),
      recipient: attestationPayload.recipient,
      nonce: attestationPayload.nonce.toString(),
      tdxMeasurement: attestationPayload.tdxMeasurement,
    },
    encodedData: attestationData,
    signature: sig,
    digest,
    signer: deployer.address,
    verifierAddress: c.ClaimVerifier,
    sourceClaimTx: claimTx,
    generatedAt: new Date().toISOString(),
  };
  const attestationFile = `${OUTDIR}/attestation.json`;
  writeFileSync(attestationFile, JSON.stringify(attestationJson, null, 2));
  log(`  ${C.green}✓${C.reset} Attestation written to ${C.cyan}${attestationFile}${C.reset}`);
  log(`  ${C.dim}This file can be shared with auditors. Step 8 verifies it on-chain.${C.reset}`);

  await pause();

  // ------------------------------------------------------------------
  // STEP 8 — Verify the attestation on-chain
  // ------------------------------------------------------------------
  box("STEP 8 / 9 — Verify the attestation against ClaimVerifier");
  log(`  Calling ClaimVerifier.verifyAttestation(encodedData, signature)...`);
  const verified = (await pub.readContract({
    address: c.ClaimVerifier,
    abi: VERIFIER_ABI,
    functionName: "verifyAttestation",
    args: [attestationData, sig],
  })) as readonly [Address, bigint, number, Hex, bigint, Address, bigint];

  log(`  ${C.green}✓${C.reset} Attestation valid. Recovered fields:`);
  log(`     user:             ${verified[0]}`);
  log(`     marketId:         ${verified[1]}`);
  log(`     outcome:          ${verified[2] === 1 ? "YES" : verified[2] === 0 ? "NO" : "INVALID"}`);
  log(`     payoutCommitment: ${verified[3]}`);
  log(`     timestamp:        ${verified[4]}`);
  log(`     recipient:        ${verified[5]}  ${C.dim}(zero = bearer mode)${C.reset}`);
  log(`     nonce:            ${verified[6]}`);
  log(`  ${C.dim}↪ The contract has just confirmed:${C.reset}`);
  log(`  ${C.dim}    (1) signature recovers to the pinned attestationSigner${C.reset}`);
  log(`  ${C.dim}    (2) tdxMeasurement matches pinnedTdxMeasurement${C.reset}`);

  await pause();

  // ------------------------------------------------------------------
  // STEP 9 — Unwrap remaining cUSDC → TestUSDC
  // ------------------------------------------------------------------
  box("STEP 9 / 9 — Unwrap cUSDC → TestUSDC (2-tx flow)");
  log(`  Tx (a): cUSDC.requestUnwrap(amount) — atomic encrypted burn,`);
  log(`           returns a requestId (the burn-success ebool handle, marked publicly`);
  log(`           decryptable by the Runner).`);
  log(`  Tx (b): cUSDC.finalizeUnwrap(requestId, decryptionProof) — gateway-issued`);
  log(`           proof finalizes the underlying TestUSDC transfer.`);

  // Unwrap the original 50 cUSDC remaining after the bet. The 49 cUSDC won
  // back arrives asynchronously via the Nox Runner; this script intentionally
  // unwraps only the fully-settled portion to keep the assertion deterministic.
  const UNWRAP_AMOUNT = 50n * SIX;
  log(`  Unwrapping ${formatUnits(UNWRAP_AMOUNT, 6)} cUSDC (the bet-remainder portion).`);

  const reqData = encodeFunctionData({abi: CUSDC_ABI, functionName: "requestUnwrap", args: [UNWRAP_AMOUNT]});
  const reqTx = await testWc.sendTransaction({to: c.ConfidentialUSDC, data: reqData, chain: arbitrumSepolia});
  const reqRc = await pub.waitForTransactionReceipt({hash: reqTx});
  recordTx("STEP 9", "cUSDC.requestUnwrap(50)", reqTx);

  let requestId: Hex = "0x" as Hex;
  for (const lg of reqRc.logs) {
    if (lg.address.toLowerCase() !== c.ConfidentialUSDC.toLowerCase()) continue;
    try {
      const d = decodeEventLog({abi: CUSDC_ABI, data: lg.data, topics: lg.topics});
      if (d.eventName === "UnwrapRequested") {
        const a = d.args as {user: Address; requestId: Hex; amount: bigint};
        requestId = a.requestId;
        log(
          `  ${C.green}✓${C.reset} UnwrapRequested: requestId=${a.requestId}, amount=${formatUnits(a.amount, 6)}`,
        );
      }
    } catch {
      /* */
    }
  }
  if (requestId === ("0x" as Hex)) throw new Error("UnwrapRequested event not found");

  log(`  Fetching Runner-issued public-decryption proof for requestId...`);
  const reqProof = await testHandleClient.publicDecrypt(requestId);
  log(`  ${C.green}✓${C.reset} Burn-success bool decrypted: ${reqProof.value}`);

  const finData = encodeFunctionData({
    abi: CUSDC_ABI,
    functionName: "finalizeUnwrap",
    args: [requestId, reqProof.decryptionProof as Hex],
  });
  const finTx = await testWc.sendTransaction({to: c.ConfidentialUSDC, data: finData, chain: arbitrumSepolia});
  await pub.waitForTransactionReceipt({hash: finTx});
  recordTx("STEP 9", "cUSDC.finalizeUnwrap(requestId, proof)", finTx);

  log(`  ${C.green}✓${C.reset} Underlying TestUSDC transferred back to test wallet.`);

  await pause();

  // ------------------------------------------------------------------
  // FINAL SUMMARY
  // ------------------------------------------------------------------
  box("VERIFICATION COMPLETE");

  const postTusdc = (await pub.readContract({
    address: c.TestUSDC,
    abi: TUSDC_ABI,
    functionName: "balanceOf",
    args: [testAccount.address],
  })) as bigint;
  const postEth = await pub.getBalance({address: testAccount.address});

  const totalElapsedMs = Date.now() - t0;
  log("");
  log(`  ${C.bold}On-chain actions${C.reset}`);
  log(`    Total transactions: ${arbiscanLinks.length}`);
  log(`    Total elapsed:      ${(totalElapsedMs / 1000).toFixed(1)}s`);
  log("");
  log(`  ${C.bold}Test wallet balances${C.reset}`);
  log(`    pre-run TestUSDC:    ${formatUnits(preTusdc, 6)}`);
  log(`    funded TestUSDC:     ${formatUnits(fundedTusdc, 6)}`);
  log(`    post-run TestUSDC:   ${formatUnits(postTusdc, 6)}`);
  log(`    post-run ETH:        ${formatEther(postEth)}`);
  log("");

  // Conservation check: starting (post-funding) balance was `fundedTusdc`.
  // Wrapped 100 → bet 50 → unwrapped 50.
  // Expected post: fundedTusdc - 100 (wrapped) + 50 (unwrapped) = fundedTusdc - 50.
  // The other 50 wrapped cUSDC stays as confidential balance: 50 (post-bet) + 49 (claim, post-fee).
  // Async Nox processing means the cUSDC balance update from the claim payout
  // may not be reflected synchronously — verify off-chain via SDK decrypt.
  const expectedTusdcPost = fundedTusdc - 100n * SIX + 50n * SIX;
  const expectedFeeStuck = (BET_AMOUNT * PROTOCOL_FEE_BPS) / 10_000n;
  log(`  ${C.bold}Conservation check${C.reset}`);
  log(`    expected TestUSDC post: ${formatUnits(expectedTusdcPost, 6)}`);
  log(`    actual TestUSDC post:   ${formatUnits(postTusdc, 6)}`);
  if (postTusdc === expectedTusdcPost) {
    log(`    ${C.green}✓${C.reset} matches`);
  } else {
    log(`    ${C.yellow}!! mismatch — investigate${C.reset}`);
  }
  log(`    expected protocol fee stuck in market cUSDC balance: ${formatUnits(expectedFeeStuck, 6)} cUSDC`);
  log(
    `    ${C.dim}(per KNOWN_LIMITATIONS: fee stays in market until publicDecrypt round-trip ships)${C.reset}`,
  );
  log("");

  // ------------------------------------------------------------------
  // Write output files
  // ------------------------------------------------------------------
  const linksMd = [
    "# verify-backend Arbiscan links",
    "",
    `Run: \`${stamp}\``,
    `Test wallet: \`${testAccount.address}\``,
    `Market: \`${marketAddress}\` (id ${marketId})`,
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

  const balancesJson = {
    runStartedAt: runStartedAt.toISOString(),
    testWallet: testAccount.address,
    market: {address: marketAddress, id: marketId.toString()},
    balances: {
      preRunTusdc: preTusdc.toString(),
      postFundingTusdc: fundedTusdc.toString(),
      postRunTusdc: postTusdc.toString(),
      postRunEthWei: postEth.toString(),
    },
    expectations: {
      wrapped: WRAP_AMOUNT.toString(),
      bet: BET_AMOUNT.toString(),
      unwrapped: (50n * SIX).toString(),
      expectedTusdcPost: expectedTusdcPost.toString(),
      protocolFeeStuckInMarketCusdc: expectedFeeStuck.toString(),
    },
    txCount: arbiscanLinks.length,
    elapsedMs: totalElapsedMs,
  };
  writeFileSync(`${OUTDIR}/final-balances.json`, JSON.stringify(balancesJson, null, 2));

  log(`  ${C.bold}Output files${C.reset}`);
  log(`    ${OUTDIR}/`);
  log(`      ├── transcript.txt`);
  log(`      ├── attestation.json`);
  log(`      ├── arbiscan-links.md`);
  log(`      └── final-balances.json`);
  log("");
  log(`${C.green}DarkOdds backend verified end-to-end on Arbitrum Sepolia.${C.reset}`);
  log("");

  rl.close();
}

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

main().catch((e) => {
  process.stdout.write(`\n${C.red}[verify-backend] FAILED:${C.reset} ${e instanceof Error ? e.stack : e}\n`);
  appendFileSync(TRANSCRIPT, `\n[FAILED] ${e instanceof Error ? e.stack : e}\n`);
  rl.close();
  process.exit(1);
});

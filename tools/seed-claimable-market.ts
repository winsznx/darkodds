/**
 * seed-claimable-market.ts — staged market lifecycle seeder.
 *
 * Three stages, controlled by `--stage`:
 *   open              — deploy market only (expiry +30 days, no bets, no
 *                       state advancement). Use to populate /markets with
 *                       fresh DarkOdds-Private cards for demo.
 *   claimable         — full lifecycle Open → Closed → Resolving →
 *                       ClaimWindow with a winning YES bet from the
 *                       winner address. Default. ~3 min runtime.
 *   settled-history   — same lifecycle plus interleaved bets from a
 *                       second signer and 5 publishBatch cycles, so the
 *                       resulting market has a rich on-chain BatchPublished
 *                       trail. ~7 min runtime.
 *
 * Optional flags:
 *   --winner-address=0x… — address that receives the winning position.
 *                          Requires WINNER_PRIVATE_KEY env var; that key's
 *                          public address must match. Default: deployer.
 *   --question="..."     — custom market question text.
 *
 * F10b operational delegation: MarketRegistry.owner is the deployer EOA, so
 * createMarket uses a direct walletClient.writeContract. TestUSDC.mint and
 * ResolutionOracle.setAdapter remain Safe-cosigned (those contracts are
 * still Safe-owned).
 */

import {readFileSync} from "node:fs";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  encodeFunctionData,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";
import Safe from "@safe-global/protocol-kit";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const WRAP_AMOUNT = 200n * 1_000_000n;
const BET_AMOUNT_BASE = 25n * 1_000_000n;
const BATCH_WAIT_S = 65;
const MARKET_EXPIRY_S_CLAIMABLE = 90;
// 9 × BATCH_WAIT_S gives 5 cycles of bet + publish (~325s) plus
// ~50s of setup overhead plus ~200s of buffer before expiry hits.
// Without this margin the trailing publishBatch races the expiry and
// occasionally lands after Closed transition.
const MARKET_EXPIRY_S_SETTLED = 9 * BATCH_WAIT_S;
const MARKET_EXPIRY_S_OPEN = 30 * 24 * 60 * 60;
const SETTLED_HISTORY_CYCLES = 5;

const SIDE_NO = 0;
const SIDE_YES = 1;
const ORACLE_TYPE_PRE_RESOLVED = 2;

type Stage = "open" | "claimable" | "settled-history";

interface CliArgs {
  stage: Stage;
  question?: string;
  winnerAddress?: Address;
}

function parseArgs(argv: string[]): CliArgs {
  let stage: Stage = "claimable";
  let question: string | undefined;
  let winnerAddress: Address | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--stage=")) {
      const v = arg.slice("--stage=".length);
      if (v !== "open" && v !== "claimable" && v !== "settled-history") {
        throw new Error(`--stage must be one of: open, claimable, settled-history (got "${v}")`);
      }
      stage = v;
    } else if (arg.startsWith("--question=")) {
      question = arg.slice("--question=".length);
    } else if (arg.startsWith("--winner-address=")) {
      const v = arg.slice("--winner-address=".length).trim();
      if (!/^0x[0-9a-fA-F]{40}$/.test(v))
        throw new Error(`--winner-address must be a 0x-prefixed 20-byte hex (got "${v}")`);
      winnerAddress = v as Address;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: seed-claimable-market [--stage=open|claimable|settled-history] [--winner-address=0x...] [--question="..."]\n` +
          `\nEnv:\n  DEPLOYER_PRIVATE_KEY  required\n  MULTISIG_SIGNER_2_PK  required (Safe co-sign + settled-history loser)\n  WINNER_PRIVATE_KEY    required iff --winner-address is set\n  ARB_SEPOLIA_RPC_URL   optional (default: public Arbitrum Sepolia RPC)`,
      );
      process.exit(0);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg} (try --help)`);
    }
  }
  return {stage, question, winnerAddress};
}

function defaultQuestion(stage: Stage): string {
  const slug = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  switch (stage) {
    case "open":
      return `seed-open: pre-staged Open market (${slug})`;
    case "claimable":
      return `seed-claimable: pre-staged YES winner (${slug})`;
    case "settled-history":
      return `seed-history: 5-batch settled market (${slug})`;
  }
}

type Deployment = {
  chainId: number;
  contracts: {
    TestUSDC: Hex;
    ConfidentialUSDC: Hex;
    MarketRegistry: Hex;
    ResolutionOracle: Hex;
    PreResolvedOracle: Hex;
    MarketImplementation_v5?: Hex;
  };
  safe: {address: Hex; threshold: number; signers: Hex[]};
};

const TUSDC_ABI = parseAbi([
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);
const CUSDC_ABI = parseAbi([
  "function wrap(uint256 amount, bytes32 encryptedAmount, bytes inputProof) external returns (bytes32)",
  "function setOperator(address operator, uint48 until) external",
  "function isOperator(address user, address operator) view returns (bool)",
]);
const REGISTRY_ABI = parseAbi([
  "function createMarket(string,string,uint8,uint256,uint256) external returns (uint256, address)",
  "function nextMarketId() view returns (uint256)",
  "function markets(uint256) view returns (address)",
]);
const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);
const PRE_ORACLE_ABI = parseAbi(["function configure(uint256 marketId, uint8 outcome) external"]);
const MARKET_ABI = parseAbi([
  "function placeBet(uint8 side, bytes32 encryptedAmount, bytes inputProof) external",
  "function publishBatch() external",
  "function resolveOracle() external",
  "function freezePool(bytes yesProof, bytes noProof) external",
  "function state() view returns (uint8)",
  "function expiryTs() view returns (uint256)",
  "function yesPoolPublishedHandle() view returns (bytes32)",
  "function noPoolPublishedHandle() view returns (bytes32)",
]);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));

  const RPC = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const PK1 = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  const PK2 = process.env["MULTISIG_SIGNER_2_PK"]?.trim() as Hex | undefined;
  if (!PK1 || !PK2) throw new Error("DEPLOYER_PRIVATE_KEY / MULTISIG_SIGNER_2_PK missing");

  const deployer = privateKeyToAccount(PK1);
  const dep = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as Deployment;
  if (dep.chainId !== ARB_SEPOLIA_CHAIN_ID) throw new Error(`bad chainId ${dep.chainId}`);

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const deployerWallet = createWalletClient({
    account: deployer,
    chain: arbitrumSepolia,
    transport: http(RPC),
  });
  const deployerNox = await createViemHandleClient(deployerWallet);

  // Resolve the winner — defaults to the deployer EOA. If --winner-address
  // is supplied, WINNER_PRIVATE_KEY env must match it (we need the key to
  // sign the bet tx; positions can't be transferred after the fact).
  let winnerWallet: WalletClient = deployerWallet;
  let winnerNox = deployerNox;
  let winnerAddr: Address = deployer.address;
  if (args.winnerAddress) {
    const wpk = process.env["WINNER_PRIVATE_KEY"]?.trim() as Hex | undefined;
    if (!wpk) {
      throw new Error(
        "--winner-address requires WINNER_PRIVATE_KEY env var (the script must sign the winning bet from that wallet)",
      );
    }
    const winAccount = privateKeyToAccount(wpk);
    if (winAccount.address.toLowerCase() !== args.winnerAddress.toLowerCase()) {
      throw new Error(
        `WINNER_PRIVATE_KEY address ${winAccount.address} does not match --winner-address ${args.winnerAddress}`,
      );
    }
    winnerWallet = createWalletClient({account: winAccount, chain: arbitrumSepolia, transport: http(RPC)});
    winnerNox = await createViemHandleClient(winnerWallet);
    winnerAddr = winAccount.address;
  }

  const sdk1 = await Safe.init({provider: RPC, signer: PK1, safeAddress: dep.safe.address});
  const sdk2 = await Safe.init({provider: RPC, signer: PK2, safeAddress: dep.safe.address});

  async function safeWrite(label: string, target: Hex, data: Hex): Promise<Hex> {
    let tx = await sdk1.createTransaction({transactions: [{to: target, value: "0", data}]});
    tx = await sdk1.signTransaction(tx);
    tx = await sdk2.signTransaction(tx);
    const exec = await sdk1.executeTransaction(tx);
    const hash =
      (exec as unknown as {hash?: Hex}).hash ??
      (exec as unknown as {transactionResponse?: {hash: Hex}}).transactionResponse?.hash;
    if (!hash) throw new Error(`Safe exec returned no hash (${label})`);
    const rc = await pub.waitForTransactionReceipt({hash});
    if (rc.status !== "success") throw new Error(`${label} reverted: ${hash}`);
    console.log(`[seed]   ${label} ✓ ${hash}`);
    return hash;
  }

  const stage = args.stage;
  const question = args.question ?? defaultQuestion(stage);
  console.log(`[seed] stage=${stage}`);
  console.log(`[seed] deployer=${deployer.address}`);
  console.log(`[seed] safe=${dep.safe.address}`);
  if (winnerAddr !== deployer.address) console.log(`[seed] winner=${winnerAddr}`);

  // ── 1. Deploy fresh PreResolvedOracle (smoke-f5 pattern) ──
  console.log(`[seed] step 1/N: deploy fresh PreResolvedOracle`);
  const art = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/out/PreResolvedOracle.sol/PreResolvedOracle.json`, "utf8"),
  ) as {bytecode: {object: Hex}};
  const ctor = encodeAbiParameters([{type: "address"}], [deployer.address]);
  const deployTx = await deployerWallet.sendTransaction({
    data: (art.bytecode.object + ctor.slice(2)) as Hex,
    to: null,
  });
  const deployRc = await pub.waitForTransactionReceipt({hash: deployTx});
  if (!deployRc.contractAddress) throw new Error("preoracle deploy failed");
  const preOracle = deployRc.contractAddress;
  console.log(`[seed]   PreOracle deployed at ${preOracle}`);

  // ── 2. createMarket — DIRECT EOA WRITE per F10b operational delegation ──
  console.log(`[seed] step 2/N: createMarket (PreResolved, expiry +${stageExpiryHuman(stage)})`);
  const expirySeconds =
    stage === "open"
      ? MARKET_EXPIRY_S_OPEN
      : stage === "settled-history"
        ? MARKET_EXPIRY_S_SETTLED
        : MARKET_EXPIRY_S_CLAIMABLE;
  const expiryTs = BigInt(Math.floor(Date.now() / 1000) + expirySeconds);
  const resolutionCriteria =
    stage === "open"
      ? "PreResolvedOracle returns YES. Pre-staged Open market for /markets demo."
      : stage === "settled-history"
        ? "PreResolvedOracle returns YES. Settled with rich BatchPublished history."
        : "PreResolvedOracle returns YES. Demo target for /portfolio claim flow.";
  const marketIdBefore = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  const createH = await deployerWallet.writeContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "createMarket",
    args: [question, resolutionCriteria, ORACLE_TYPE_PRE_RESOLVED, expiryTs, 200n],
  });
  await pub.waitForTransactionReceipt({hash: createH});
  console.log(`[seed]   create-market ✓ ${createH}`);
  const marketId = marketIdBefore;
  const marketAddr = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketId],
  })) as Address;
  console.log(`[seed]   Market[${marketId}] @ ${marketAddr}`);

  // ── 3. PreOracle.configure(YES) — owned by deployer EOA, direct write ──
  console.log(`[seed] step 3/N: PreOracle.configure(YES)`);
  const cfg = await deployerWallet.writeContract({
    address: preOracle,
    abi: PRE_ORACLE_ABI,
    functionName: "configure",
    args: [marketId, SIDE_YES],
  });
  await pub.waitForTransactionReceipt({hash: cfg});
  console.log(`[seed]   configure ✓ ${cfg}`);

  // ── 4. ResolutionOracle.setAdapter — Safe-owned, still cosigned ──
  console.log(`[seed] step 4/N: ResolutionOracle.setAdapter`);
  await safeWrite(
    "set-adapter",
    dep.contracts.ResolutionOracle,
    encodeFunctionData({abi: RES_ORACLE_ABI, functionName: "setAdapter", args: [marketId, preOracle]}),
  );

  if (stage === "open") {
    const arbiscan = `https://sepolia.arbiscan.io/address/${marketAddr}`;
    console.log(`\n[seed] ============================================================`);
    console.log(`[seed] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`[seed] Market #${marketId} deployed in Open state. Question: ${question}`);
    console.log(`[seed] Address: ${marketAddr}`);
    console.log(`[seed] Arbiscan: ${arbiscan}`);
    console.log(`[seed] Detail:   http://localhost:3000/markets/${marketId}`);
    return;
  }

  // ── helper: wallet+nox bundle with tUSDC funded, cUSDC wrapped, market authorized ──
  async function setupBettor(label: string, w: WalletClient): Promise<void> {
    const addr = w.account!.address;
    console.log(`[seed]   setupBettor[${label}] addr=${addr}`);
    await safeWrite(
      `${label}/mint-tusdc`,
      dep.contracts.TestUSDC,
      encodeFunctionData({abi: TUSDC_ABI, functionName: "mint", args: [addr, WRAP_AMOUNT * 2n]}),
    );
    const allowance = (await pub.readContract({
      address: dep.contracts.TestUSDC,
      abi: TUSDC_ABI,
      functionName: "allowance",
      args: [addr, dep.contracts.ConfidentialUSDC],
    })) as bigint;
    if (allowance < WRAP_AMOUNT) {
      const h = await w.writeContract({
        chain: arbitrumSepolia,
        account: w.account!,
        address: dep.contracts.TestUSDC,
        abi: TUSDC_ABI,
        functionName: "approve",
        args: [dep.contracts.ConfidentialUSDC, WRAP_AMOUNT * 2n],
      });
      await pub.waitForTransactionReceipt({hash: h});
      console.log(`[seed]   ${label}/approve ✓ ${h}`);
    }
    const wh = await (
      label === "deployer" || label === "winner" ? winnerNox : await createViemHandleClient(w)
    ).encryptInput(WRAP_AMOUNT, "uint256", dep.contracts.ConfidentialUSDC);
    const wrapH = await w.writeContract({
      chain: arbitrumSepolia,
      account: w.account!,
      address: dep.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "wrap",
      args: [WRAP_AMOUNT, wh.handle as Hex, wh.handleProof as Hex],
    });
    await pub.waitForTransactionReceipt({hash: wrapH});
    console.log(`[seed]   ${label}/wrap ✓ ${wrapH}`);
    const isOp = (await pub.readContract({
      address: dep.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "isOperator",
      args: [addr, marketAddr],
    })) as boolean;
    if (!isOp) {
      const until = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      const h = await w.writeContract({
        chain: arbitrumSepolia,
        account: w.account!,
        address: dep.contracts.ConfidentialUSDC,
        abi: CUSDC_ABI,
        functionName: "setOperator",
        args: [marketAddr, until],
      });
      await pub.waitForTransactionReceipt({hash: h});
      console.log(`[seed]   ${label}/setOperator ✓ ${h}`);
    }
  }

  async function placeBetFrom(
    label: string,
    w: WalletClient,
    nox: Awaited<ReturnType<typeof createViemHandleClient>>,
    side: 0 | 1,
    amount: bigint,
  ): Promise<void> {
    const enc = await nox.encryptInput(amount, "uint256", marketAddr as Hex);
    const h = await w.writeContract({
      chain: arbitrumSepolia,
      account: w.account!,
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "placeBet",
      args: [side, enc.handle as Hex, enc.handleProof as Hex],
    });
    await pub.waitForTransactionReceipt({hash: h});
    console.log(`[seed]   ${label}/placeBet[${side === SIDE_YES ? "YES" : "NO"}, ${amount}] ✓ ${h}`);
  }

  async function publishBatchOnce(label: string): Promise<void> {
    const h = await deployerWallet.writeContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "publishBatch",
    });
    await pub.waitForTransactionReceipt({hash: h});
    console.log(`[seed]   ${label}/publishBatch ✓ ${h}`);
  }

  async function resolveAndFreeze(): Promise<{yes: bigint; no: bigint}> {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (expiryTs > now) {
      const wait = Number(expiryTs - now) + 5;
      console.log(`[seed]   sleeping ${wait}s for expiry`);
      await sleep(wait * 1000);
    }
    const resolveH = await deployerWallet.writeContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "resolveOracle",
    });
    await pub.waitForTransactionReceipt({hash: resolveH});
    console.log(`[seed]   resolveOracle ✓ ${resolveH}`);

    const yesHandle = (await pub.readContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "yesPoolPublishedHandle",
    })) as Hex;
    const noHandle = (await pub.readContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "noPoolPublishedHandle",
    })) as Hex;
    const yesPub = await deployerNox.publicDecrypt(yesHandle);
    const noPub = await deployerNox.publicDecrypt(noHandle);
    console.log(`[seed]   yes plain: ${yesPub.value}, no plain: ${noPub.value}`);
    const freezeH = await deployerWallet.writeContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "freezePool",
      args: [yesPub.decryptionProof as Hex, noPub.decryptionProof as Hex],
    });
    await pub.waitForTransactionReceipt({hash: freezeH});
    console.log(`[seed]   freezePool ✓ ${freezeH}`);
    return {yes: BigInt(yesPub.value), no: BigInt(noPub.value)};
  }

  if (stage === "claimable") {
    console.log(`[seed] step 5/9: setup winner bettor (${winnerAddr})`);
    await setupBettor("winner", winnerWallet);

    console.log(`[seed] step 6/9: place winning bet (YES, ${BET_AMOUNT_BASE / 1_000_000n} cUSDC)`);
    await placeBetFrom("winner", winnerWallet, winnerNox, SIDE_YES, BET_AMOUNT_BASE);

    console.log(`[seed] step 7/9: sleeping ${BATCH_WAIT_S}s for batch interval`);
    await sleep(BATCH_WAIT_S * 1000);
    await publishBatchOnce("step7");

    console.log(`[seed] step 8/9: wait for expiry + resolveOracle + freezePool`);
    const {yes, no} = await resolveAndFreeze();

    const finalState = (await pub.readContract({
      address: marketAddr,
      abi: MARKET_ABI,
      functionName: "state",
    })) as number;
    const arbiscan = `https://sepolia.arbiscan.io/address/${marketAddr}`;
    console.log(`\n[seed] ============================================================`);
    console.log(`[seed] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(`[seed] Market #${marketId} ready for claim by ${winnerAddr}`);
    console.log(`[seed] State: ${finalState} (5=ClaimWindow)`);
    console.log(`[seed] Winning outcome: YES`);
    console.log(`[seed] Final pool YES: ${yes}, NO: ${no}`);
    console.log(`[seed] Address:  ${marketAddr}`);
    console.log(`[seed] Arbiscan: ${arbiscan}`);
    console.log(`[seed] Frontend: http://localhost:3000/portfolio`);
    console.log(`[seed] Detail:   http://localhost:3000/markets/${marketId}`);
    return;
  }

  // ── settled-history: two bettors + 5 publishBatch cycles ──
  const signer2Account = privateKeyToAccount(PK2);
  const signer2Wallet = createWalletClient({
    account: signer2Account,
    chain: arbitrumSepolia,
    transport: http(RPC),
  });
  const signer2Nox = await createViemHandleClient(signer2Wallet);

  // Auto-fund any bettor wallet whose ETH balance is below 0.003 ETH (~30
  // txs of headroom). Top up to 0.005 ETH from the deployer EOA. Idempotent:
  // skipped on subsequent runs because the balance is now above threshold.
  const GAS_FLOOR_WEI = 3_000_000_000_000_000n; // 0.003 ETH
  const GAS_TOPUP_WEI = 5_000_000_000_000_000n; // 0.005 ETH
  async function ensureGas(label: string, target: Address): Promise<void> {
    const balance = await pub.getBalance({address: target});
    if (balance >= GAS_FLOOR_WEI) {
      console.log(`[seed]   ${label}/gas-balance ✓ ${balance} wei (above ${GAS_FLOOR_WEI})`);
      return;
    }
    console.log(
      `[seed]   ${label}/gas-balance LOW (${balance} wei). Funding ${GAS_TOPUP_WEI} wei from deployer.`,
    );
    const fundH = await deployerWallet.sendTransaction({
      to: target,
      value: GAS_TOPUP_WEI,
    });
    await pub.waitForTransactionReceipt({hash: fundH});
    console.log(`[seed]   ${label}/gas-fund ✓ ${fundH}`);
  }

  console.log(`[seed] step 5/X: setup winner bettor (${winnerAddr})`);
  if (winnerAddr !== deployer.address) await ensureGas("winner", winnerAddr);
  await setupBettor("winner", winnerWallet);
  console.log(`[seed] step 6/X: setup signer2 bettor (${signer2Account.address})`);
  await ensureGas("signer2", signer2Account.address);
  await setupBettor("signer2", signer2Wallet);

  // Each address can bet only once per side per market (Market.sol's
  // AlreadyBetThisSide guard). Settled-history places exactly two bets —
  // winner YES early, signer2 NO mid-loop — and lets the remaining cycles
  // produce empty BatchPublished events. Five batches total: two carry the
  // bets, three are empty trailing batches that still emit
  // BatchPublished + advance lastBatchTs.
  console.log(
    `[seed] step 7/X: ${SETTLED_HISTORY_CYCLES} cycles (2 bets staggered + ${SETTLED_HISTORY_CYCLES - 2} empty batches)`,
  );
  let batchCount = 0;
  for (let i = 0; i < SETTLED_HISTORY_CYCLES; i++) {
    if (i === 0) {
      await placeBetFrom("winner", winnerWallet, winnerNox, SIDE_YES, BET_AMOUNT_BASE);
    } else if (i === 1) {
      await placeBetFrom("signer2", signer2Wallet, signer2Nox, SIDE_NO, BET_AMOUNT_BASE / 2n);
    }
    await sleep(BATCH_WAIT_S * 1000);
    await publishBatchOnce(`cycle${i + 1}`);
    batchCount++;
  }

  console.log(`[seed] step 8/X: wait for expiry + resolveOracle + freezePool`);
  const {yes, no} = await resolveAndFreeze();

  const finalState = (await pub.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "state",
  })) as number;
  const arbiscan = `https://sepolia.arbiscan.io/address/${marketAddr}`;
  console.log(`\n[seed] ============================================================`);
  console.log(`[seed] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(
    `[seed] Market #${marketId} settled with rich on-chain history. Batch count: ${batchCount}. Final pool YES: ${yes} cUSDC, NO: ${no} cUSDC`,
  );
  console.log(`[seed] State: ${finalState} (5=ClaimWindow)`);
  console.log(`[seed] Winner address: ${winnerAddr}`);
  console.log(`[seed] Address:  ${marketAddr}`);
  console.log(`[seed] Arbiscan: ${arbiscan}`);
  console.log(`[seed] Detail:   http://localhost:3000/markets/${marketId}`);
}

function stageExpiryHuman(stage: Stage): string {
  switch (stage) {
    case "open":
      return "30 days";
    case "settled-history":
      return `${MARKET_EXPIRY_S_SETTLED}s`;
    case "claimable":
      return `${MARKET_EXPIRY_S_CLAIMABLE}s`;
  }
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});

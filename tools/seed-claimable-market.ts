/**
 * F10b — seed-claimable-market.ts
 *
 * Creates a fresh market and advances it through the full lifecycle (Open →
 * Closed → Resolving → ClaimWindow) WITHOUT claiming, leaving a real
 * claimable position the /portfolio UI can exercise.
 *
 * Distilled from `tools/smoke-f5.ts` (Lifecycle A) — same Safe-cosigned
 * createMarket + Nox encryptInput + freezePool flow, but stops one step
 * before claimWinnings.
 *
 * Outputs the new market id at the end. Total runtime ~3 minutes
 * (90s expiry + 65s batch interval + ~30s of txs).
 */

import {readFileSync} from "node:fs";

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";
import {createViemHandleClient} from "@iexec-nox/handle";
import Safe from "@safe-global/protocol-kit";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const WRAP_AMOUNT = 200n * 1_000_000n;
const BET_AMOUNT = 25n * 1_000_000n;
const BATCH_WAIT_S = 65;
const MARKET_EXPIRY_S = 90;

const SEED_OUTCOME_NO = 0;
const QUESTION = `f10b claimable seed (${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")})`;
const RESOLUTION_CRITERIA = "PreResolvedOracle returns NO. Demo target for /portfolio claim flow.";

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

async function main(): Promise<void> {
  const t0 = Date.now();
  const RPC = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const PK1 = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  const PK2 = process.env["MULTISIG_SIGNER_2_PK"]?.trim() as Hex | undefined;
  if (!PK1 || !PK2) throw new Error("DEPLOYER_PRIVATE_KEY / MULTISIG_SIGNER_2_PK missing");

  const account = privateKeyToAccount(PK1);
  const dep = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as Deployment;
  if (dep.chainId !== ARB_SEPOLIA_CHAIN_ID) throw new Error(`bad chainId ${dep.chainId}`);

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wallet = createWalletClient({account, chain: arbitrumSepolia, transport: http(RPC)});
  const nox = await createViemHandleClient(wallet);

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

  console.log(`[seed] deployer=${account.address}`);
  console.log(`[seed] safe=${dep.safe.address}`);

  // ── 1. Deploy fresh PreOracle (smoke-f5 pattern: each run gets its own) ──
  console.log(`[seed] step 1/9: deploy fresh PreResolvedOracle`);
  const art = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/out/PreResolvedOracle.sol/PreResolvedOracle.json`, "utf8"),
  ) as {bytecode: {object: Hex}};
  const ctor = encodeAbiParameters([{type: "address"}], [account.address]);
  const deployTx = await wallet.sendTransaction({
    data: (art.bytecode.object + ctor.slice(2)) as Hex,
    to: null,
  });
  const deployRc = await pub.waitForTransactionReceipt({hash: deployTx});
  if (!deployRc.contractAddress) throw new Error("preoracle deploy failed");
  const preOracle = deployRc.contractAddress;
  console.log(`[seed]   PreOracle deployed at ${preOracle}`);

  // ── 2. tUSDC mint + approve + wrap ──
  console.log(`[seed] step 2/9: tUSDC mint + approve + wrap`);
  await safeWrite(
    "mint-tusdc",
    dep.contracts.TestUSDC,
    encodeFunctionData({abi: TUSDC_ABI, functionName: "mint", args: [account.address, WRAP_AMOUNT * 2n]}),
  );
  const allowance = (await pub.readContract({
    address: dep.contracts.TestUSDC,
    abi: TUSDC_ABI,
    functionName: "allowance",
    args: [account.address, dep.contracts.ConfidentialUSDC],
  })) as bigint;
  if (allowance < WRAP_AMOUNT) {
    const h = await wallet.writeContract({
      address: dep.contracts.TestUSDC,
      abi: TUSDC_ABI,
      functionName: "approve",
      args: [dep.contracts.ConfidentialUSDC, WRAP_AMOUNT * 2n],
    });
    await pub.waitForTransactionReceipt({hash: h});
    console.log(`[seed]   approve ✓ ${h}`);
  } else {
    console.log(`[seed]   approve skipped (allowance ${allowance})`);
  }
  const wh = await nox.encryptInput(WRAP_AMOUNT, "uint256", dep.contracts.ConfidentialUSDC);
  const wrapH = await wallet.writeContract({
    address: dep.contracts.ConfidentialUSDC,
    abi: CUSDC_ABI,
    functionName: "wrap",
    args: [WRAP_AMOUNT, wh.handle as Hex, wh.handleProof as Hex],
  });
  await pub.waitForTransactionReceipt({hash: wrapH});
  console.log(`[seed]   wrap ✓ ${wrapH}`);

  // ── 3. Safe-cosign createMarket ──
  console.log(`[seed] step 3/9: createMarket (PreResolved, expiry +${MARKET_EXPIRY_S}s)`);
  const expiryTs = BigInt(Math.floor(Date.now() / 1000) + MARKET_EXPIRY_S);
  const createMarketIdBefore = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "nextMarketId",
  })) as bigint;
  await safeWrite(
    "create-market",
    dep.contracts.MarketRegistry,
    encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "createMarket",
      args: [QUESTION, RESOLUTION_CRITERIA, 2, expiryTs, 200n],
    }),
  );
  const marketId = createMarketIdBefore;
  const marketAddr = (await pub.readContract({
    address: dep.contracts.MarketRegistry,
    abi: REGISTRY_ABI,
    functionName: "markets",
    args: [marketId],
  })) as Hex;
  console.log(`[seed]   Market[${marketId}] @ ${marketAddr}`);

  // ── 4. Configure PreOracle (NO outcome — deployer's bet on NO will win) ──
  console.log(`[seed] step 4/9: PreOracle.configure(NO)`);
  const cfg = await wallet.writeContract({
    address: preOracle,
    abi: PRE_ORACLE_ABI,
    functionName: "configure",
    args: [marketId, SEED_OUTCOME_NO],
  });
  await pub.waitForTransactionReceipt({hash: cfg});
  console.log(`[seed]   configure ✓ ${cfg}`);

  // ── 5. Safe-cosign setAdapter ──
  console.log(`[seed] step 5/9: ResolutionOracle.setAdapter`);
  await safeWrite(
    "set-adapter",
    dep.contracts.ResolutionOracle,
    encodeFunctionData({abi: RES_ORACLE_ABI, functionName: "setAdapter", args: [marketId, preOracle]}),
  );

  // ── 6. setOperator + place bet on NO side (winning side) ──
  console.log(`[seed] step 6/9: setOperator + placeBet (NO)`);
  const isOp = (await pub.readContract({
    address: dep.contracts.ConfidentialUSDC,
    abi: CUSDC_ABI,
    functionName: "isOperator",
    args: [account.address, marketAddr],
  })) as boolean;
  if (!isOp) {
    const until = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const h = await wallet.writeContract({
      address: dep.contracts.ConfidentialUSDC,
      abi: CUSDC_ABI,
      functionName: "setOperator",
      args: [marketAddr, until],
    });
    await pub.waitForTransactionReceipt({hash: h});
    console.log(`[seed]   setOperator ✓ ${h}`);
  } else {
    console.log(`[seed]   setOperator skipped (already authorized)`);
  }
  const bet = await nox.encryptInput(BET_AMOUNT, "uint256", marketAddr);
  const placeBetH = await wallet.writeContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "placeBet",
    args: [SEED_OUTCOME_NO, bet.handle as Hex, bet.handleProof as Hex],
  });
  await pub.waitForTransactionReceipt({hash: placeBetH});
  console.log(`[seed]   placeBet ✓ ${placeBetH}`);

  // ── 7. Wait + publishBatch ──
  console.log(`[seed] step 7/9: sleeping ${BATCH_WAIT_S}s for batch interval`);
  await new Promise((r) => setTimeout(r, BATCH_WAIT_S * 1000));
  const pubBatchH = await wallet.writeContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "publishBatch",
  });
  await pub.waitForTransactionReceipt({hash: pubBatchH});
  console.log(`[seed]   publishBatch ✓ ${pubBatchH}`);

  // ── 8. Wait for expiry + resolveOracle ──
  console.log(`[seed] step 8/9: wait for expiry + resolveOracle`);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (expiryTs > now) {
    const wait = Number(expiryTs - now) + 5;
    console.log(`[seed]   sleeping ${wait}s for expiry`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  const resolveH = await wallet.writeContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "resolveOracle",
  });
  await pub.waitForTransactionReceipt({hash: resolveH});
  console.log(`[seed]   resolveOracle ✓ ${resolveH}`);

  // ── 9. publicDecrypt + freezePool → ClaimWindow ──
  console.log(`[seed] step 9/9: publicDecrypt + freezePool → ClaimWindow`);
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
  const yesPub = await nox.publicDecrypt(yesHandle);
  const noPub = await nox.publicDecrypt(noHandle);
  console.log(`[seed]   yes plain: ${yesPub.value}, no plain: ${noPub.value}`);
  const freezeH = await wallet.writeContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "freezePool",
    args: [yesPub.decryptionProof as Hex, noPub.decryptionProof as Hex],
  });
  await pub.waitForTransactionReceipt({hash: freezeH});
  console.log(`[seed]   freezePool ✓ ${freezeH}`);

  const finalState = (await pub.readContract({
    address: marketAddr,
    abi: MARKET_ABI,
    functionName: "state",
  })) as number;

  console.log(`\n[seed] ============================================================`);
  console.log(`[seed] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[seed] Market[${marketId}] @ ${marketAddr}`);
  console.log(`[seed] State: ${finalState} (5=ClaimWindow)`);
  console.log(`[seed] Winning outcome: NO`);
  console.log(`[seed] Deployer (${account.address}) bet ${Number(BET_AMOUNT) / 1e6} cUSDC on NO — claimable`);
  console.log(`[seed] Frontend: http://localhost:3000/portfolio`);
  console.log(`[seed] Detail:   http://localhost:3000/markets/${marketId}`);
}

main().catch((e) => {
  console.error("[seed] FAILED:", e);
  process.exit(1);
});

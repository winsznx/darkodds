// SPDX-License-Identifier: MIT
//
// F4.5 — Deploy patched Market implementation and point existing
// registry at it via the Safe multisig.
//
// What it does:
//   1. Compiles contracts via forge.
//   2. Deploys MarketImplementation v3 (the F4.5 hardened source).
//   3. Reads the production MarketRegistry address from deployments.
//   4. Builds a Safe transaction setting the registry's marketImplementation
//      to the new v3 address.
//   5. Signs the Safe tx with PK1 + PK2 (2-of-3) and executes.
//   6. Verifies registry.marketImplementation() == v3 on-chain.
//   7. Writes the new address into deployments json under
//      `contracts.MarketImplementation_v3` (without dropping the legacy
//      v2 address — F5 may need to compare).
//   8. Verifies MarketImpl v3 on Arbiscan via Etherscan V2 API.
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, MULTISIG_SIGNER_2_PK,
//                MULTISIG_SIGNER_3_PK, ARB_SEPOLIA_RPC_URL,
//                ARBISCAN_API_KEY)
// Writes: contracts/deployments/arb-sepolia.json (in-place)

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseAbi,
  encodeFunctionData,
  type Hex,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import Safe from "@safe-global/protocol-kit";
import {execSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";

const ARBISCAN_API = "https://api.etherscan.io/v2/api?chainid=421614";
const ARBISCAN_BASE = "https://sepolia.arbiscan.io";

const REGISTRY_ABI = parseAbi([
  "function setMarketImplementation(address newImpl) external",
  "function marketImplementation() view returns (address)",
]);

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function safeExecAs2of3(
  safeAddress: string,
  rpcUrl: string,
  pk1: Hex,
  pk2: Hex,
  to: Hex,
  data: Hex,
): Promise<Hex> {
  // Owner #1 creates and signs.
  const sdk1 = await Safe.init({provider: rpcUrl, signer: pk1, safeAddress});
  let tx = await sdk1.createTransaction({transactions: [{to, value: "0", data}]});
  tx = await sdk1.signTransaction(tx);

  // Owner #2 signs.
  const sdk2 = await Safe.init({provider: rpcUrl, signer: pk2, safeAddress});
  tx = await sdk2.signTransaction(tx);

  // Owner #1 executes (deployer pays gas).
  const exec = await sdk1.executeTransaction(tx);
  // Safe SDK returns transactionResponse with hash on most providers.
  const hash = (exec.hash ||
    (exec as unknown as {transactionResponse?: {hash: string}}).transactionResponse?.hash) as Hex | undefined;
  if (!hash) throw new Error("Safe executeTransaction returned no hash");
  return hash;
}

function verifyOnArbiscan(addr: string, contractPath: string, contractName: string) {
  const apiKey = process.env["ARBISCAN_API_KEY"]?.trim();
  if (!apiKey) {
    console.log(`[deploy-f45] no ARBISCAN_API_KEY, skipping verification`);
    return;
  }
  const cmd =
    `ETHERSCAN_API_KEY='${apiKey}' forge verify-contract ${addr} ${contractPath}:${contractName} ` +
    `--verifier etherscan --verifier-url '${ARBISCAN_API}' ` +
    `--watch --num-of-optimizations 200 --compiler-version 0.8.34 --chain-id 421614`;
  try {
    execSync(cmd, {cwd: `${process.cwd()}/contracts`, stdio: "inherit", timeout: 240_000});
  } catch (err) {
    console.warn(`[deploy-f45] verify warning:`, err instanceof Error ? err.message : err);
  }
}

async function main() {
  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;
  const PK2 = need("MULTISIG_SIGNER_2_PK") as Hex;

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account});

  console.log(`[deploy-f45] Deployer: ${account.address}`);
  const bal = await pub.getBalance({address: account.address});
  console.log(`[deploy-f45] Balance:  ${formatEther(bal)} ETH`);
  if (bal < 5_000_000_000_000_000n) throw new Error("balance < 0.005 ETH; top up");

  console.log(`[deploy-f45] forge build...`);
  execSync("forge build", {cwd: `${process.cwd()}/contracts`, stdio: "inherit"});

  const dep = JSON.parse(readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8")) as {
    contracts: Record<string, Hex>;
    safe: {address: string};
    arbiscan?: Record<string, string>;
    notes?: Record<string, string>;
  };
  if (!dep.safe?.address) throw new Error("Safe not yet deployed; run deploy-multisig.ts first");
  const safeAddress = dep.safe.address;
  const registryAddress = dep.contracts.MarketRegistry;
  console.log(`[deploy-f45] Safe:     ${safeAddress}`);
  console.log(`[deploy-f45] Registry: ${registryAddress}`);

  // ----- 1. Deploy MarketImpl v3 (idempotent — if already in deployments, reuse) -----
  let marketImplV3: Hex;
  if (dep.contracts.MarketImplementation_v3) {
    marketImplV3 = dep.contracts.MarketImplementation_v3;
    const code = await pub.getCode({address: marketImplV3});
    if (code && code.length > 2) {
      console.log(`[deploy-f45] reusing existing MarketImplementation_v3: ${marketImplV3}`);
    } else {
      throw new Error(`stale MarketImplementation_v3 entry; remove from deployments json`);
    }
  } else {
    const art = JSON.parse(readFileSync(`${process.cwd()}/contracts/out/Market.sol/Market.json`, "utf8")) as {
      bytecode: {object: Hex};
    };
    console.log(`[deploy-f45] deploying MarketImplementation v3...`);
    const deployHash = await wc.sendTransaction({to: null, data: art.bytecode.object});
    const deployRc = await pub.waitForTransactionReceipt({hash: deployHash});
    if (deployRc.status !== "success" || !deployRc.contractAddress) {
      throw new Error(`MarketImpl v3 deploy failed: ${deployHash}`);
    }
    marketImplV3 = deployRc.contractAddress;
    console.log(`[deploy-f45] MarketImplementation_v3: ${marketImplV3}  (tx ${deployHash})`);
  }

  // ----- 2. Safe-mediated setMarketImplementation -----
  console.log(`[deploy-f45] preparing Safe tx: registry.setMarketImplementation(${marketImplV3})...`);
  const setImplData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "setMarketImplementation",
    args: [marketImplV3],
  });

  const txHash = await safeExecAs2of3(safeAddress, RPC, PK1, PK2, registryAddress, setImplData);
  console.log(`[deploy-f45] Safe tx executed: ${txHash}`);
  await pub.waitForTransactionReceipt({hash: txHash});

  // ----- 3. Verify registry now points at v3 -----
  const onchainImpl = (await pub.readContract({
    address: registryAddress,
    abi: REGISTRY_ABI,
    functionName: "marketImplementation",
  })) as `0x${string}`;
  if (onchainImpl.toLowerCase() !== marketImplV3.toLowerCase()) {
    throw new Error(`registry impl mismatch: got ${onchainImpl}, expected ${marketImplV3}`);
  }
  console.log(`[deploy-f45] registry.marketImplementation() == v3 ✓`);

  // ----- 4. Update deployments json -----
  // Preserve old impl as legacy reference for audit trail.
  const oldImpl = dep.contracts.MarketImplementation;
  dep.notes = dep.notes ?? {};
  dep.notes["f4_legacy_MarketImplementation"] = oldImpl;
  dep.notes["f45_marketimpl_swap_tx"] = txHash;
  dep.contracts.MarketImplementation = marketImplV3;
  dep.contracts.MarketImplementation_v3 = marketImplV3;
  dep.arbiscan = dep.arbiscan ?? {};
  dep.arbiscan.MarketImplementation_v3 = `${ARBISCAN_BASE}/address/${marketImplV3}`;
  writeFileSync(
    `${process.cwd()}/contracts/deployments/arb-sepolia.json`,
    JSON.stringify(dep, null, 2) + "\n",
  );
  console.log(`[deploy-f45] deployments json updated`);

  // ----- 5. Verify on Arbiscan -----
  console.log(`[deploy-f45] verifying MarketImpl v3 on Arbiscan...`);
  verifyOnArbiscan(marketImplV3, "src/Market.sol", "Market");

  console.log(`\n[deploy-f45] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[deploy-f45] MarketImpl v3: ${marketImplV3}`);
  console.log(`[deploy-f45] ${ARBISCAN_BASE}/address/${marketImplV3}`);
}

main().catch((e) => {
  console.error("[deploy-f45] FAILED:", e);
  process.exit(1);
});

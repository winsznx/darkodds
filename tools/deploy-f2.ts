/**
 * Phase F2 deployer using viem.
 *
 * Foundry 1.6.0 forge create / forge script both fail against the public Arb
 * Sepolia RPC: alloy expects `timestampMillis` in eth_getBlockByNumber, which
 * Arbitrum nodes don't return. Workaround: deploy directly via viem, then
 * verify each contract on Blockscout via its API.
 *
 * After deploy, write deployments/arb-sepolia.json and submit verification.
 */

import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {execSync} from "node:child_process";
import {createPublicClient, createWalletClient, http, encodeAbiParameters, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const NOX_PROTOCOL = "0xd464B198f06756a1d00be223634b85E0a731c229";
const BLOCKSCOUT_API = "https://arbitrum-sepolia.blockscout.com/api/";
const BLOCKSCOUT_BASE = "https://arbitrum-sepolia.blockscout.com";

type ForgeArtifact = {
  abi: unknown[];
  bytecode: {object: Hex};
  metadata: {settings?: {compilationTarget?: Record<string, string>}};
};

function loadArtifact(contractName: string): ForgeArtifact {
  const path = `${process.cwd()}/contracts/out/${contractName}.sol/${contractName}.json`;
  return JSON.parse(readFileSync(path, "utf8")) as ForgeArtifact;
}

async function main(): Promise<void> {
  const rpcUrl = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in env");
  const account = privateKeyToAccount(privateKey);

  console.log(`[deploy-f2] Deployer: ${account.address}`);
  console.log(`[deploy-f2] RPC:      ${rpcUrl}`);

  // Build first so artifacts are fresh.
  console.log(`[deploy-f2] Building contracts...`);
  execSync("forge build", {cwd: `${process.cwd()}/contracts`, stdio: "inherit"});

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});

  const balance = await publicClient.getBalance({address: account.address});
  console.log(`[deploy-f2] Balance:  ${balance} wei (${Number(balance) / 1e18} ETH)`);
  if (balance < 1_000_000_000_000_000n) {
    throw new Error("Deployer balance too low (< 0.001 ETH). Fund the wallet first.");
  }

  // ============================================================
  // 1. TestUSDC
  // ============================================================

  const testUsdcArt = loadArtifact("TestUSDC");
  const testUsdcCtorArgs = encodeAbiParameters([{type: "address"}], [account.address]);
  const testUsdcInitcode = (testUsdcArt.bytecode.object + testUsdcCtorArgs.slice(2)) as Hex;

  console.log(`[deploy-f2] Deploying TestUSDC...`);
  const testUsdcHash = await walletClient.sendTransaction({data: testUsdcInitcode, to: null});
  console.log(`[deploy-f2]   tx: ${testUsdcHash}`);
  const testUsdcReceipt = await publicClient.waitForTransactionReceipt({hash: testUsdcHash});
  if (testUsdcReceipt.status !== "success" || !testUsdcReceipt.contractAddress) {
    throw new Error(`TestUSDC deploy failed: ${JSON.stringify(testUsdcReceipt)}`);
  }
  const testUsdcAddr = testUsdcReceipt.contractAddress;
  console.log(`[deploy-f2]   TestUSDC: ${testUsdcAddr}`);

  // ============================================================
  // 2. ConfidentialUSDC
  // ============================================================

  const cusdcArt = loadArtifact("ConfidentialUSDC");
  const cusdcCtorArgs = encodeAbiParameters(
    [{type: "address"}, {type: "string"}, {type: "string"}],
    [testUsdcAddr, "Confidential tUSDC", "ctUSDC"],
  );
  const cusdcInitcode = (cusdcArt.bytecode.object + cusdcCtorArgs.slice(2)) as Hex;

  console.log(`[deploy-f2] Deploying ConfidentialUSDC...`);
  const cusdcHash = await walletClient.sendTransaction({data: cusdcInitcode, to: null});
  console.log(`[deploy-f2]   tx: ${cusdcHash}`);
  const cusdcReceipt = await publicClient.waitForTransactionReceipt({hash: cusdcHash});
  if (cusdcReceipt.status !== "success" || !cusdcReceipt.contractAddress) {
    throw new Error(`ConfidentialUSDC deploy failed: ${JSON.stringify(cusdcReceipt)}`);
  }
  const cusdcAddr = cusdcReceipt.contractAddress;
  console.log(`[deploy-f2]   ConfidentialUSDC: ${cusdcAddr}`);

  // ============================================================
  // 3. Write deployments/arb-sepolia.json
  // ============================================================

  const dir = `${process.cwd()}/contracts/deployments`;
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  const deployedAt = Math.floor(Date.now() / 1000);
  const json = {
    chainId: ARB_SEPOLIA_CHAIN_ID,
    contracts: {
      TestUSDC: testUsdcAddr,
      ConfidentialUSDC: cusdcAddr,
      NoxProtocol: NOX_PROTOCOL,
    },
    deployer: account.address,
    deployedAt,
    txs: {
      TestUSDC: testUsdcHash,
      ConfidentialUSDC: cusdcHash,
    },
    blockscout: {
      TestUSDC: `${BLOCKSCOUT_BASE}/address/${testUsdcAddr}`,
      ConfidentialUSDC: `${BLOCKSCOUT_BASE}/address/${cusdcAddr}`,
    },
  };
  writeFileSync(`${dir}/arb-sepolia.json`, JSON.stringify(json, null, 2) + "\n");
  console.log(`[deploy-f2] Wrote ${dir}/arb-sepolia.json`);

  // ============================================================
  // 4. Submit Blockscout verification (fire-and-forget)
  // ============================================================

  console.log(`[deploy-f2] Submitting Blockscout verifications...`);
  for (const [name, addr] of [
    ["TestUSDC", testUsdcAddr],
    ["ConfidentialUSDC", cusdcAddr],
  ] as const) {
    try {
      // Blockscout doesn't require an API key but forge insists on the env var.
      execSync(
        `ETHERSCAN_API_KEY=blockscout forge verify-contract ${addr} src/${name}.sol:${name} ` +
          `--verifier blockscout --verifier-url '${BLOCKSCOUT_API}' ` +
          `--watch --num-of-optimizations 200 --compiler-version 0.8.34`,
        {cwd: `${process.cwd()}/contracts`, stdio: "inherit", timeout: 180_000},
      );
    } catch (err) {
      console.warn(
        `[deploy-f2]   ${name} verify warning (often ok if Blockscout auto-verified):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`\n[deploy-f2] Done.`);
  console.log(`[deploy-f2] TestUSDC:         ${BLOCKSCOUT_BASE}/address/${testUsdcAddr}`);
  console.log(`[deploy-f2] ConfidentialUSDC: ${BLOCKSCOUT_BASE}/address/${cusdcAddr}`);
}

main().catch((err) => {
  console.error(`[deploy-f2] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});

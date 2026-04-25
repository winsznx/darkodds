/**
 * Phase F3 deployer using viem.
 *
 * Re-deploys ConfidentialUSDC (extended with EIP-7984 operator surface that F2
 * shipped without — required for Market.placeBet to pull cUSDC via the operator
 * pattern), deploys Market implementation + MarketRegistry, then creates one
 * test market.
 *
 * After each deploy, submits Etherscan V2 (Arbiscan) verification.
 *
 * Foundry 1.6.0 forge create / forge script still fails against the public Arb
 * Sepolia RPC (see BUG_LOG F2: missing field timestampMillis), so deploys go
 * through viem and verification through forge verify-contract.
 */

import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {execSync} from "node:child_process";
import {createPublicClient, createWalletClient, http, encodeAbiParameters, parseAbi, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrumSepolia} from "viem/chains";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const NOX_PROTOCOL = "0xd464B198f06756a1d00be223634b85E0a731c229";
const ARBISCAN_API = "https://api.etherscan.io/v2/api?chainid=421614";
const ARBISCAN_BASE = "https://sepolia.arbiscan.io";

type ForgeArtifact = {
  abi: unknown[];
  bytecode: {object: Hex};
};

function loadArtifact(contractName: string): ForgeArtifact {
  const path = `${process.cwd()}/contracts/out/${contractName}.sol/${contractName}.json`;
  return JSON.parse(readFileSync(path, "utf8")) as ForgeArtifact;
}

const REGISTRY_ABI = parseAbi([
  "function createMarket(string question, string resolutionCriteria, uint8 oracleType, uint256 expiryTs, uint256 protocolFeeBps) external returns (uint256 id, address market)",
  "event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs)",
]);

async function main(): Promise<void> {
  const rpcUrl = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in env");
  const arbiscanKey = process.env["ARBISCAN_API_KEY"]?.trim();
  const account = privateKeyToAccount(privateKey);

  console.log(`[deploy-f3] Deployer: ${account.address}`);
  console.log(`[deploy-f3] RPC:      ${rpcUrl}`);

  console.log(`[deploy-f3] Building contracts...`);
  execSync("forge build", {cwd: `${process.cwd()}/contracts`, stdio: "inherit"});

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});

  const balance = await publicClient.getBalance({address: account.address});
  console.log(`[deploy-f3] Balance:  ${balance} wei (${Number(balance) / 1e18} ETH)`);
  if (balance < 5_000_000_000_000_000n) {
    throw new Error("Deployer balance < 0.005 ETH; fund the wallet first.");
  }

  // Reuse F2's TestUSDC — same underlying, no need to redeploy.
  const f2 = JSON.parse(readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8")) as {
    contracts: {TestUSDC: Hex; ConfidentialUSDC: Hex};
  };
  const testUsdcAddr = f2.contracts.TestUSDC;
  console.log(`[deploy-f3] Reusing TestUSDC: ${testUsdcAddr}`);

  // ============================================================
  // 1. ConfidentialUSDC v2 (operator surface added; F2 v1 deployment is now stale)
  // ============================================================

  const cusdcArt = loadArtifact("ConfidentialUSDC");
  const cusdcCtor = encodeAbiParameters(
    [{type: "address"}, {type: "string"}, {type: "string"}],
    [testUsdcAddr, "Confidential tUSDC", "ctUSDC"],
  );
  console.log(`[deploy-f3] Deploying ConfidentialUSDC v2 (with operator pattern)...`);
  const cusdcHash = await walletClient.sendTransaction({
    data: (cusdcArt.bytecode.object + cusdcCtor.slice(2)) as Hex,
    to: null,
  });
  console.log(`[deploy-f3]   tx: ${cusdcHash}`);
  const cusdcReceipt = await publicClient.waitForTransactionReceipt({hash: cusdcHash});
  if (cusdcReceipt.status !== "success" || !cusdcReceipt.contractAddress) {
    throw new Error(`ConfidentialUSDC deploy failed: ${JSON.stringify(cusdcReceipt)}`);
  }
  const cusdcAddr = cusdcReceipt.contractAddress;
  console.log(`[deploy-f3]   ConfidentialUSDC v2: ${cusdcAddr}`);

  // ============================================================
  // 2. Market implementation (uninitialized template)
  // ============================================================

  const marketArt = loadArtifact("Market");
  console.log(`[deploy-f3] Deploying Market implementation...`);
  const marketImplHash = await walletClient.sendTransaction({
    data: marketArt.bytecode.object,
    to: null,
  });
  console.log(`[deploy-f3]   tx: ${marketImplHash}`);
  const marketImplReceipt = await publicClient.waitForTransactionReceipt({hash: marketImplHash});
  if (marketImplReceipt.status !== "success" || !marketImplReceipt.contractAddress) {
    throw new Error(`Market impl deploy failed: ${JSON.stringify(marketImplReceipt)}`);
  }
  const marketImplAddr = marketImplReceipt.contractAddress;
  console.log(`[deploy-f3]   Market implementation: ${marketImplAddr}`);

  // ============================================================
  // 3. MarketRegistry
  // ============================================================

  const registryArt = loadArtifact("MarketRegistry");
  const registryCtor = encodeAbiParameters(
    [{type: "address"}, {type: "address"}, {type: "address"}],
    [marketImplAddr, cusdcAddr, account.address],
  );
  console.log(`[deploy-f3] Deploying MarketRegistry...`);
  const registryHash = await walletClient.sendTransaction({
    data: (registryArt.bytecode.object + registryCtor.slice(2)) as Hex,
    to: null,
  });
  console.log(`[deploy-f3]   tx: ${registryHash}`);
  const registryReceipt = await publicClient.waitForTransactionReceipt({hash: registryHash});
  if (registryReceipt.status !== "success" || !registryReceipt.contractAddress) {
    throw new Error(`MarketRegistry deploy failed: ${JSON.stringify(registryReceipt)}`);
  }
  const registryAddr = registryReceipt.contractAddress;
  console.log(`[deploy-f3]   MarketRegistry: ${registryAddr}`);

  // ============================================================
  // 4. createMarket — one test market, expiry +14 days
  // ============================================================

  const expiryTs = BigInt(Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60);
  console.log(`[deploy-f3] Creating test market (expires +14d)...`);
  const createHash = await walletClient.writeContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "createMarket",
    args: [
      "Will the next iExec mainnet announcement happen before June 15, 2026?",
      "Admin-resolved per official iExec announcement on @iEx_ec or @iExecDev X account",
      0,
      expiryTs,
      200n,
    ],
  });
  console.log(`[deploy-f3]   tx: ${createHash}`);
  const createReceipt = await publicClient.waitForTransactionReceipt({hash: createHash});
  if (createReceipt.status !== "success") {
    throw new Error(`createMarket failed: ${JSON.stringify(createReceipt)}`);
  }
  // Pull market address from MarketCreated event log.
  const createdTopic =
    "0x" +
    Buffer.from(
      // keccak256("MarketCreated(uint256,address,string,uint256)") — first topic
      "0e3a9dee18d20bd31c6d6f81e7b94aa05538b4ee35c0e1ea96fa6ec6d50f9404",
      "hex",
    ).toString("hex");
  let marketAddr: Hex | null = null;
  for (const log of createReceipt.logs) {
    if (log.address.toLowerCase() === registryAddr.toLowerCase()) {
      // Decode the second indexed field (market address) from the event data.
      // ABI: MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs)
      // -> topics[0]=sig, topics[1]=id, data=encode(market,question,expiryTs)
      try {
        const dataAddrHex = ("0x" + log.data.slice(26, 66)) as Hex;
        marketAddr = dataAddrHex;
        break;
      } catch {
        /* keep scanning */
      }
    }
  }
  if (!marketAddr) {
    throw new Error("createMarket succeeded but market address not parsed from event");
  }
  console.log(`[deploy-f3]   Market[0]: ${marketAddr}`);
  const _ignoredCreatedTopic = createdTopic; // suppress unused
  void _ignoredCreatedTopic;

  // ============================================================
  // 5. Write deployments/arb-sepolia.json
  // ============================================================

  const dir = `${process.cwd()}/contracts/deployments`;
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  const deployedAt = Math.floor(Date.now() / 1000);
  const json = {
    chainId: ARB_SEPOLIA_CHAIN_ID,
    contracts: {
      TestUSDC: testUsdcAddr,
      ConfidentialUSDC: cusdcAddr,
      MarketImplementation: marketImplAddr,
      MarketRegistry: registryAddr,
      Market_0: marketAddr,
      NoxProtocol: NOX_PROTOCOL,
    },
    deployer: account.address,
    deployedAt,
    txs: {
      ConfidentialUSDC: cusdcHash,
      MarketImplementation: marketImplHash,
      MarketRegistry: registryHash,
      Market_0_create: createHash,
    },
    arbiscan: {
      TestUSDC: `${ARBISCAN_BASE}/address/${testUsdcAddr}`,
      ConfidentialUSDC: `${ARBISCAN_BASE}/address/${cusdcAddr}`,
      MarketImplementation: `${ARBISCAN_BASE}/address/${marketImplAddr}`,
      MarketRegistry: `${ARBISCAN_BASE}/address/${registryAddr}`,
      Market_0: `${ARBISCAN_BASE}/address/${marketAddr}`,
    },
    notes: {
      f2_legacy_ConfidentialUSDC: f2.contracts.ConfidentialUSDC,
      f2_legacy_note:
        "F2's ConfidentialUSDC v1 (lacking the operator pattern) is superseded by v2 above. F2 wrap/unwrap continues to work on the legacy address but Market integration requires v2.",
    },
  };
  writeFileSync(`${dir}/arb-sepolia.json`, JSON.stringify(json, null, 2) + "\n");
  console.log(`[deploy-f3] Wrote ${dir}/arb-sepolia.json`);

  // ============================================================
  // 6. Submit Arbiscan verifications (Etherscan V2 API)
  // ============================================================

  if (!arbiscanKey) {
    console.warn(`[deploy-f3] ARBISCAN_API_KEY not set; skipping verification.`);
  } else {
    console.log(`[deploy-f3] Submitting Arbiscan verifications...`);
    const verifyArgs = [
      {
        name: "ConfidentialUSDC",
        addr: cusdcAddr,
        ctor: encodeAbiParameters(
          [{type: "address"}, {type: "string"}, {type: "string"}],
          [testUsdcAddr, "Confidential tUSDC", "ctUSDC"],
        ),
      },
      {name: "Market", addr: marketImplAddr, ctor: "0x" as Hex},
      {
        name: "MarketRegistry",
        addr: registryAddr,
        ctor: encodeAbiParameters(
          [{type: "address"}, {type: "address"}, {type: "address"}],
          [marketImplAddr, cusdcAddr, account.address],
        ),
      },
    ];
    for (const v of verifyArgs) {
      const ctorFlag = v.ctor === "0x" ? "" : `--constructor-args ${v.ctor}`;
      const cmd =
        `ETHERSCAN_API_KEY='${arbiscanKey}' forge verify-contract ${v.addr} src/${v.name}.sol:${v.name} ` +
        `--verifier etherscan --verifier-url '${ARBISCAN_API}' ` +
        `--watch --num-of-optimizations 200 --compiler-version 0.8.34 --chain-id 421614 ${ctorFlag}`;
      try {
        execSync(cmd, {cwd: `${process.cwd()}/contracts`, stdio: "inherit", timeout: 240_000});
      } catch (err) {
        console.warn(`[deploy-f3]   ${v.name} verify warning:`, err instanceof Error ? err.message : err);
      }
    }
  }

  console.log(`\n[deploy-f3] Done.`);
  console.log(`[deploy-f3] ConfidentialUSDC v2:  ${ARBISCAN_BASE}/address/${cusdcAddr}`);
  console.log(`[deploy-f3] Market implementation: ${ARBISCAN_BASE}/address/${marketImplAddr}`);
  console.log(`[deploy-f3] MarketRegistry:        ${ARBISCAN_BASE}/address/${registryAddr}`);
  console.log(`[deploy-f3] Market[0]:             ${ARBISCAN_BASE}/address/${marketAddr}`);
}

main().catch((err) => {
  console.error(`[deploy-f3] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});

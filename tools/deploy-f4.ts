/**
 * Phase F4 deployer using viem.
 *
 * Deploys the resolution + claim suite:
 *   - Market implementation v2 (replaces F3 stubs with full F4 logic)
 *   - MarketRegistry v2 (new constructor signature: now takes resolutionOracle)
 *   - ResolutionOracle (orchestrator)
 *   - AdminOracle, PreResolvedOracle, ChainlinkPriceOracle (adapters)
 *   - ClaimVerifier (placeholder TDX measurement; F5 redeploys with real one)
 *   - FeeVault
 *
 * Then creates two new test markets:
 *   - Market[1]: AdminOracle-resolved, expires +14d
 *   - Market[2]: PreResolvedOracle-resolved, hardcoded YES (the "guaranteed
 *     demo flow" market from PRD §3.3 step G)
 *
 * Skips the BTC-Chainlink demo market: per the librarian-verified
 * smartcontractkit/hardhat-chainlink registry, no Chainlink data feeds (price
 * or sequencer uptime) are deployed on Arbitrum Sepolia. The contract is built
 * to spec for mainnet but cannot be wired against live feeds on testnet.
 */

import {readFileSync, writeFileSync} from "node:fs";
import {execSync} from "node:child_process";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  keccak256,
  toHex,
  parseAbi,
  type Hex,
} from "viem";
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

function loadArtifact(path: string, contractName: string): ForgeArtifact {
  const p = `${process.cwd()}/contracts/out/${path}/${contractName}.json`;
  return JSON.parse(readFileSync(p, "utf8")) as ForgeArtifact;
}

const REGISTRY_ABI = parseAbi([
  "function createMarket(string question, string resolutionCriteria, uint8 oracleType, uint256 expiryTs, uint256 protocolFeeBps) external returns (uint256 id, address market)",
]);

const RES_ORACLE_ABI = parseAbi(["function setAdapter(uint256 marketId, address adapter) external"]);

const PRE_ORACLE_ABI = parseAbi(["function configure(uint256 marketId, uint8 outcome) external"]);

const FEE_VAULT_ABI = parseAbi(["function setMarketRegistered(address market, bool registered) external"]);

async function main(): Promise<void> {
  const rpcUrl = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || "https://sepolia-rollup.arbitrum.io/rpc";
  const privateKey = process.env["DEPLOYER_PRIVATE_KEY"]?.trim() as Hex | undefined;
  if (!privateKey) throw new Error("DEPLOYER_PRIVATE_KEY missing in env");
  const arbiscanKey = process.env["ARBISCAN_API_KEY"]?.trim();
  const account = privateKeyToAccount(privateKey);

  console.log(`[deploy-f4] Deployer: ${account.address}`);
  console.log(`[deploy-f4] RPC:      ${rpcUrl}`);

  console.log(`[deploy-f4] Building contracts...`);
  execSync("forge build", {cwd: `${process.cwd()}/contracts`, stdio: "inherit"});

  const publicClient = createPublicClient({chain: arbitrumSepolia, transport: http(rpcUrl)});
  const walletClient = createWalletClient({account, chain: arbitrumSepolia, transport: http(rpcUrl)});

  const balance = await publicClient.getBalance({address: account.address});
  console.log(`[deploy-f4] Balance:  ${balance} wei (${Number(balance) / 1e18} ETH)`);
  if (balance < 10_000_000_000_000_000n) {
    throw new Error("Deployer balance < 0.01 ETH; F4 needs ~0.005 ETH for ~7 deploys + tx batch.");
  }

  // Reuse F2/F3 deployments.
  const prior = JSON.parse(
    readFileSync(`${process.cwd()}/contracts/deployments/arb-sepolia.json`, "utf8"),
  ) as {
    contracts: {
      TestUSDC: Hex;
      ConfidentialUSDC: Hex;
      MarketImplementation?: Hex;
      MarketRegistry?: Hex;
      Market_0?: Hex;
    };
    notes?: Record<string, unknown>;
  };
  const testUsdcAddr = prior.contracts.TestUSDC;
  const cusdcAddr = prior.contracts.ConfidentialUSDC;
  console.log(`[deploy-f4] Reusing TestUSDC:         ${testUsdcAddr}`);
  console.log(`[deploy-f4] Reusing ConfidentialUSDC: ${cusdcAddr}`);

  async function deploy(
    name: string,
    artifactPath: string,
    contract: string,
    ctorTypes: string[],
    ctorArgs: unknown[],
  ): Promise<Hex> {
    const art = loadArtifact(artifactPath, contract);
    const ctorEnc =
      ctorTypes.length === 0
        ? "0x"
        : encodeAbiParameters(
            ctorTypes.map((t) => ({type: t})),
            ctorArgs,
          );
    console.log(`[deploy-f4] Deploying ${name}...`);
    const hash = await walletClient.sendTransaction({
      data: (art.bytecode.object + ctorEnc.slice(2)) as Hex,
      to: null,
    });
    const receipt = await publicClient.waitForTransactionReceipt({hash});
    if (receipt.status !== "success" || !receipt.contractAddress) {
      throw new Error(`${name} deploy failed: ${JSON.stringify(receipt)}`);
    }
    console.log(`[deploy-f4]   ${name}: ${receipt.contractAddress}  (tx ${hash})`);
    return receipt.contractAddress;
  }

  // ============================================================
  // 1. ResolutionOracle (owner = deployer)
  // ============================================================
  const resOracleAddr = await deploy(
    "ResolutionOracle",
    "ResolutionOracle.sol",
    "ResolutionOracle",
    ["address"],
    [account.address],
  );

  // ============================================================
  // 2. AdminOracle / PreResolvedOracle (owner = deployer)
  // ============================================================
  const adminOracleAddr = await deploy(
    "AdminOracle",
    "AdminOracle.sol",
    "AdminOracle",
    ["address"],
    [account.address],
  );
  const preOracleAddr = await deploy(
    "PreResolvedOracle",
    "PreResolvedOracle.sol",
    "PreResolvedOracle",
    ["address"],
    [account.address],
  );

  // ============================================================
  // 3. ChainlinkPriceOracle (sequencerFeed = address(0) on testnet — no Chainlink feeds on Arb Sepolia)
  // ============================================================
  const chainlinkOracleAddr = await deploy(
    "ChainlinkPriceOracle",
    "ChainlinkPriceOracle.sol",
    "ChainlinkPriceOracle",
    ["address", "address"],
    ["0x0000000000000000000000000000000000000000", account.address],
  );

  // ============================================================
  // 4. FeeVault (owner = deployer)
  // ============================================================
  const feeVaultAddr = await deploy("FeeVault", "FeeVault.sol", "FeeVault", ["address"], [account.address]);

  // ============================================================
  // 5. ClaimVerifier (placeholder measurement; F5 redeploys with real TDX)
  // ============================================================
  const placeholderMeasurement = keccak256(toHex("DARKODDS_F4_DEMO_MEASUREMENT"));
  const claimVerifierAddr = await deploy(
    "ClaimVerifier",
    "ClaimVerifier.sol",
    "ClaimVerifier",
    ["bytes32", "address"],
    [placeholderMeasurement, account.address],
  );

  // ============================================================
  // 6. Market implementation v2 (full F4 logic; replaces F3 stub-revert version)
  // ============================================================
  const marketImplAddr = await deploy("Market(impl)", "Market.sol", "Market", [], []);

  // ============================================================
  // 7. MarketRegistry v2 (new ctor signature with resolutionOracle)
  // ============================================================
  const registryAddr = await deploy(
    "MarketRegistry",
    "MarketRegistry.sol",
    "MarketRegistry",
    ["address", "address", "address", "address"],
    [marketImplAddr, cusdcAddr, resOracleAddr, account.address],
  );

  // ============================================================
  // 8. createMarket: Market[1] (admin-resolved, +14d)
  // ============================================================
  const expiry14d = BigInt(Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60);
  console.log(`[deploy-f4] Creating Market[1] (admin-resolved, +14d)...`);
  const create1Hash = await walletClient.writeContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "createMarket",
    args: [
      "Will the next iExec mainnet announcement happen before June 15, 2026?",
      "Admin-resolved per official iExec announcement on @iEx_ec or @iExecDev X account",
      0,
      expiry14d,
      200n,
    ],
  });
  const create1Rcpt = await publicClient.waitForTransactionReceipt({hash: create1Hash});
  if (create1Rcpt.status !== "success") throw new Error(`createMarket(1) failed`);
  let market1Addr: Hex | null = null;
  for (const log of create1Rcpt.logs) {
    if (log.address.toLowerCase() === registryAddr.toLowerCase()) {
      market1Addr = (`0x` + log.data.slice(26, 66)) as Hex;
      break;
    }
  }
  if (!market1Addr) throw new Error("Market[1] address not parsed");
  console.log(`[deploy-f4]   Market[1]: ${market1Addr}`);

  // ============================================================
  // 9. createMarket: Market[2] (pre-resolved YES, +1d expiry)
  // ============================================================
  const expiry1d = BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60);
  console.log(`[deploy-f4] Creating Market[2] (pre-resolved YES, +1d)...`);
  const create2Hash = await walletClient.writeContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: "createMarket",
    args: [
      "Pre-resolved demo market: did Q4 2025 happen?",
      "Hardcoded YES outcome via PreResolvedOracle for guaranteed claim-flow demo",
      2,
      expiry1d,
      200n,
    ],
  });
  const create2Rcpt = await publicClient.waitForTransactionReceipt({hash: create2Hash});
  if (create2Rcpt.status !== "success") throw new Error(`createMarket(2) failed`);
  let market2Addr: Hex | null = null;
  for (const log of create2Rcpt.logs) {
    if (log.address.toLowerCase() === registryAddr.toLowerCase()) {
      market2Addr = (`0x` + log.data.slice(26, 66)) as Hex;
      break;
    }
  }
  if (!market2Addr) throw new Error("Market[2] address not parsed");
  console.log(`[deploy-f4]   Market[2]: ${market2Addr}`);

  // ============================================================
  // 10. Wire adapters into ResolutionOracle (await each receipt — viem's
  // automatic nonce inference races without explicit serialization here)
  // ============================================================
  async function wcWait(p: ReturnType<typeof walletClient.writeContract>): Promise<void> {
    const hash = await p;
    await publicClient.waitForTransactionReceipt({hash});
  }

  console.log(`[deploy-f4] Wiring adapters into ResolutionOracle...`);
  await wcWait(
    walletClient.writeContract({
      address: resOracleAddr,
      abi: RES_ORACLE_ABI,
      functionName: "setAdapter",
      args: [1n, adminOracleAddr],
    }),
  );
  await wcWait(
    walletClient.writeContract({
      address: resOracleAddr,
      abi: RES_ORACLE_ABI,
      functionName: "setAdapter",
      args: [2n, preOracleAddr],
    }),
  );
  await wcWait(
    walletClient.writeContract({
      address: preOracleAddr,
      abi: PRE_ORACLE_ABI,
      functionName: "configure",
      args: [2n, 1],
    }),
  );
  await wcWait(
    walletClient.writeContract({
      address: feeVaultAddr,
      abi: FEE_VAULT_ABI,
      functionName: "setMarketRegistered",
      args: [market1Addr, true],
    }),
  );
  await wcWait(
    walletClient.writeContract({
      address: feeVaultAddr,
      abi: FEE_VAULT_ABI,
      functionName: "setMarketRegistered",
      args: [market2Addr, true],
    }),
  );

  // ============================================================
  // 11. Persist deployment
  // ============================================================
  const deployedAt = Math.floor(Date.now() / 1000);
  const out = {
    chainId: ARB_SEPOLIA_CHAIN_ID,
    contracts: {
      TestUSDC: testUsdcAddr,
      ConfidentialUSDC: cusdcAddr,
      MarketImplementation: marketImplAddr,
      MarketRegistry: registryAddr,
      ResolutionOracle: resOracleAddr,
      AdminOracle: adminOracleAddr,
      PreResolvedOracle: preOracleAddr,
      ChainlinkPriceOracle: chainlinkOracleAddr,
      ClaimVerifier: claimVerifierAddr,
      FeeVault: feeVaultAddr,
      Market_1: market1Addr,
      Market_2: market2Addr,
      NoxProtocol: NOX_PROTOCOL,
    },
    deployer: account.address,
    deployedAt,
    arbiscan: {
      MarketImplementation: `${ARBISCAN_BASE}/address/${marketImplAddr}`,
      MarketRegistry: `${ARBISCAN_BASE}/address/${registryAddr}`,
      ResolutionOracle: `${ARBISCAN_BASE}/address/${resOracleAddr}`,
      AdminOracle: `${ARBISCAN_BASE}/address/${adminOracleAddr}`,
      PreResolvedOracle: `${ARBISCAN_BASE}/address/${preOracleAddr}`,
      ChainlinkPriceOracle: `${ARBISCAN_BASE}/address/${chainlinkOracleAddr}`,
      ClaimVerifier: `${ARBISCAN_BASE}/address/${claimVerifierAddr}`,
      FeeVault: `${ARBISCAN_BASE}/address/${feeVaultAddr}`,
      Market_1: `${ARBISCAN_BASE}/address/${market1Addr}`,
      Market_2: `${ARBISCAN_BASE}/address/${market2Addr}`,
    },
    notes: {
      ...(prior.notes ?? {}),
      f3_legacy_MarketImplementation: prior.contracts.MarketImplementation ?? "",
      f3_legacy_MarketRegistry: prior.contracts.MarketRegistry ?? "",
      f3_legacy_Market_0: prior.contracts.Market_0 ?? "",
      f3_legacy_note:
        "F3's Market implementation + registry + Market[0] are superseded. Old Market[0] still works for placeBet/publishBatch but its F4 surface (resolveOracle/claim/refund) reverts PhaseNotImplemented.",
      f4_chainlink_skip:
        "Chainlink data feeds are not deployed on Arb Sepolia (verified against smartcontractkit/hardhat-chainlink registry). ChainlinkPriceOracle is deployed for mainnet completeness; the BTC-resolved demo market is omitted from testnet per PRD §0.5 'no mocks'.",
      f4_claim_verifier_placeholder:
        "ClaimVerifier pinned to keccak256('DARKODDS_F4_DEMO_MEASUREMENT'). F5 redeploys with the real TDX measurement once the TEE handler image is built.",
    },
  };
  writeFileSync(
    `${process.cwd()}/contracts/deployments/arb-sepolia.json`,
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log(`[deploy-f4] Wrote deployments/arb-sepolia.json`);

  // ============================================================
  // 12. Verify on Arbiscan (Etherscan V2)
  // ============================================================
  if (!arbiscanKey) {
    console.warn(`[deploy-f4] ARBISCAN_API_KEY not set; skipping verification.`);
    return;
  }
  console.log(`[deploy-f4] Submitting Arbiscan verifications...`);

  type V = {addr: Hex; path: string; ctor: Hex};
  const toVerify: V[] = [
    {addr: marketImplAddr, path: "src/Market.sol:Market", ctor: "0x"},
    {
      addr: registryAddr,
      path: "src/MarketRegistry.sol:MarketRegistry",
      ctor: encodeAbiParameters(
        [{type: "address"}, {type: "address"}, {type: "address"}, {type: "address"}],
        [marketImplAddr, cusdcAddr, resOracleAddr, account.address],
      ),
    },
    {
      addr: resOracleAddr,
      path: "src/ResolutionOracle.sol:ResolutionOracle",
      ctor: encodeAbiParameters([{type: "address"}], [account.address]),
    },
    {
      addr: adminOracleAddr,
      path: "src/oracles/AdminOracle.sol:AdminOracle",
      ctor: encodeAbiParameters([{type: "address"}], [account.address]),
    },
    {
      addr: preOracleAddr,
      path: "src/oracles/PreResolvedOracle.sol:PreResolvedOracle",
      ctor: encodeAbiParameters([{type: "address"}], [account.address]),
    },
    {
      addr: chainlinkOracleAddr,
      path: "src/oracles/ChainlinkPriceOracle.sol:ChainlinkPriceOracle",
      ctor: encodeAbiParameters(
        [{type: "address"}, {type: "address"}],
        ["0x0000000000000000000000000000000000000000", account.address],
      ),
    },
    {
      addr: claimVerifierAddr,
      path: "src/ClaimVerifier.sol:ClaimVerifier",
      ctor: encodeAbiParameters(
        [{type: "bytes32"}, {type: "address"}],
        [placeholderMeasurement, account.address],
      ),
    },
    {
      addr: feeVaultAddr,
      path: "src/FeeVault.sol:FeeVault",
      ctor: encodeAbiParameters([{type: "address"}], [account.address]),
    },
  ];

  for (const v of toVerify) {
    const ctorFlag = v.ctor === "0x" ? "" : `--constructor-args ${v.ctor}`;
    const cmd =
      `ETHERSCAN_API_KEY='${arbiscanKey}' forge verify-contract ${v.addr} ${v.path} ` +
      `--verifier etherscan --verifier-url '${ARBISCAN_API}' ` +
      `--watch --num-of-optimizations 200 --compiler-version 0.8.34 --chain-id 421614 ${ctorFlag}`;
    try {
      execSync(cmd, {cwd: `${process.cwd()}/contracts`, stdio: "inherit", timeout: 240_000});
    } catch (err) {
      console.warn(`[deploy-f4]   ${v.path} verify warning:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n[deploy-f4] Done. See deployments/arb-sepolia.json + Arbiscan links.`);
}

main().catch((err) => {
  console.error(`[deploy-f4] FATAL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});

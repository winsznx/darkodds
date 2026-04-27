// SPDX-License-Identifier: MIT
//
// F7 — Deploy Faucet on Arb Sepolia, transfer ownership to the 2-of-3 Safe
// via co-signed transferOwnership tx, verify on Arbiscan, write to deployments.
//
// What it does:
//   1. forge build
//   2. Deploy Faucet(token=TestUSDC, initialOwner=DEPLOYER) — idempotent (skips
//      if MarketImpl-style entry already present + bytecode on-chain).
//   3. Owner is initially the deployer EOA so we can call transferOwnership
//      without going through the Safe in the same tx (Faucet's Ownable expects
//      a non-zero owner at construction time).
//   4. Build a Safe tx? No — for transferOwnership FROM the deployer EOA, we
//      just send a regular tx. The Safe becomes the destination owner. After
//      this, all subsequent ownership ops MUST be Safe-cosigned.
//   5. Verify Faucet.owner() == Safe address on-chain.
//   6. Write to deployments json under contracts.Faucet + arbiscan + ownership.
//   7. Verify on Arbiscan via Etherscan V2 API.
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, ARB_SEPOLIA_RPC_URL, ARBISCAN_API_KEY)
// Writes: contracts/deployments/arb-sepolia.json (in-place)

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseAbi,
  encodeAbiParameters,
  type Hex,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import {execSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";

const ARBISCAN_API = "https://api.etherscan.io/v2/api?chainid=421614";
const ARBISCAN_BASE = "https://sepolia.arbiscan.io";

const FAUCET_ABI = parseAbi([
  "function transferOwnership(address newOwner) external",
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function CLAIM_AMOUNT() view returns (uint256)",
  "function COOLDOWN() view returns (uint256)",
]);

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function verifyOnArbiscan(addr: string, contractPath: string, contractName: string, ctorArgs?: string): void {
  const apiKey = process.env["ARBISCAN_API_KEY"]?.trim();
  if (!apiKey) {
    console.log(`[deploy-faucet] no ARBISCAN_API_KEY, skipping verification`);
    return;
  }
  const ctorFlag = ctorArgs ? `--constructor-args ${ctorArgs}` : "";
  const cmd =
    `ETHERSCAN_API_KEY='${apiKey}' forge verify-contract ${addr} ${contractPath}:${contractName} ` +
    `--verifier etherscan --verifier-url '${ARBISCAN_API}' ` +
    `${ctorFlag} ` +
    `--watch --num-of-optimizations 200 --compiler-version 0.8.34 --chain-id 421614`;
  try {
    execSync(cmd, {cwd: `${process.cwd()}/contracts`, stdio: "inherit", timeout: 240_000});
  } catch (err) {
    console.warn(`[deploy-faucet] verify warning:`, err instanceof Error ? err.message : err);
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as Hex;

  const account = privateKeyToAccount(PK1);
  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account});

  console.log(`[deploy-faucet] Deployer: ${account.address}`);
  const bal = await pub.getBalance({address: account.address});
  console.log(`[deploy-faucet] Balance:  ${formatEther(bal)} ETH`);
  if (bal < 5_000_000_000_000_000n) throw new Error("balance < 0.005 ETH; top up");

  console.log(`[deploy-faucet] forge build...`);
  execSync("forge build", {cwd: `${process.cwd()}/contracts`, stdio: "inherit"});

  const depPath = `${process.cwd()}/contracts/deployments/arb-sepolia.json`;
  const dep = JSON.parse(readFileSync(depPath, "utf8")) as {
    contracts: Record<string, Hex>;
    safe: {address: Hex};
    arbiscan?: Record<string, string>;
    notes?: Record<string, string>;
    ownership?: {
      previousOwner?: string;
      currentOwner?: string;
      contracts?: Record<
        string,
        {address: string; previousOwner: string; currentOwner: string; transferTx: string}
      >;
    };
  };
  if (!dep.safe?.address) throw new Error("Safe not deployed; run deploy-multisig.ts first");
  if (!dep.contracts.TestUSDC) throw new Error("TestUSDC not in deployments");

  const safeAddr = dep.safe.address;
  const tusdcAddr = dep.contracts.TestUSDC;
  console.log(`[deploy-faucet] Safe:     ${safeAddr}`);
  console.log(`[deploy-faucet] TestUSDC: ${tusdcAddr}`);

  // ----- 1. Deploy Faucet (idempotent) -----
  let faucetAddr: Hex;
  if (dep.contracts.Faucet) {
    faucetAddr = dep.contracts.Faucet;
    const code = await pub.getCode({address: faucetAddr});
    if (code && code.length > 2) {
      console.log(`[deploy-faucet] reusing existing Faucet: ${faucetAddr}`);
    } else {
      throw new Error(`stale Faucet entry; remove from deployments json before redeploy`);
    }
  } else {
    const art = JSON.parse(readFileSync(`${process.cwd()}/contracts/out/Faucet.sol/Faucet.json`, "utf8")) as {
      bytecode: {object: Hex};
    };

    // Initial owner is the deployer; we transfer to Safe right after.
    const ctorArgs = encodeAbiParameters(
      [
        {type: "address"}, // tokenAddress
        {type: "address"}, // initialOwner
      ],
      [tusdcAddr, account.address],
    );
    const data = (art.bytecode.object + ctorArgs.slice(2)) as Hex;

    console.log(`[deploy-faucet] deploying Faucet(token=${tusdcAddr}, owner=${account.address})...`);
    const deployHash = await wc.sendTransaction({to: null, data});
    const deployRc = await pub.waitForTransactionReceipt({hash: deployHash});
    if (deployRc.status !== "success" || !deployRc.contractAddress) {
      throw new Error(`Faucet deploy failed: ${deployHash}`);
    }
    faucetAddr = deployRc.contractAddress as Hex;
    console.log(`[deploy-faucet] Faucet: ${faucetAddr}  (tx ${deployHash})`);
  }

  // Sanity-check: token() and constants on the deployed contract.
  const onchainToken = (await pub.readContract({
    address: faucetAddr,
    abi: FAUCET_ABI,
    functionName: "token",
  })) as Hex;
  if (onchainToken.toLowerCase() !== tusdcAddr.toLowerCase()) {
    throw new Error(`Faucet.token mismatch: ${onchainToken} vs ${tusdcAddr}`);
  }
  const claimAmount = (await pub.readContract({
    address: faucetAddr,
    abi: FAUCET_ABI,
    functionName: "CLAIM_AMOUNT",
  })) as bigint;
  const cooldown = (await pub.readContract({
    address: faucetAddr,
    abi: FAUCET_ABI,
    functionName: "COOLDOWN",
  })) as bigint;
  console.log(`[deploy-faucet] CLAIM_AMOUNT: ${claimAmount} (${Number(claimAmount) / 1e6} TestUSDC)`);
  console.log(`[deploy-faucet] COOLDOWN:     ${cooldown}s (${Number(cooldown) / 3600}h)`);

  // ----- 2. Transfer ownership Faucet → Safe -----
  let transferTx: Hex | undefined;
  const currentOwner = (await pub.readContract({
    address: faucetAddr,
    abi: FAUCET_ABI,
    functionName: "owner",
  })) as Hex;
  if (currentOwner.toLowerCase() === safeAddr.toLowerCase()) {
    console.log(`[deploy-faucet] ownership already at Safe; skipping transfer`);
  } else if (currentOwner.toLowerCase() === account.address.toLowerCase()) {
    console.log(`[deploy-faucet] transferring ownership: deployer → Safe...`);
    const {request} = await pub.simulateContract({
      address: faucetAddr,
      abi: FAUCET_ABI,
      functionName: "transferOwnership",
      args: [safeAddr],
      account,
    });
    transferTx = await wc.writeContract(request);
    const rc = await pub.waitForTransactionReceipt({hash: transferTx});
    if (rc.status !== "success") throw new Error(`transferOwnership failed: ${transferTx}`);
    console.log(`[deploy-faucet] transferOwnership tx: ${transferTx}`);
  } else {
    throw new Error(
      `Faucet owner is ${currentOwner}, neither deployer nor Safe — manual intervention needed`,
    );
  }

  const finalOwner = (await pub.readContract({
    address: faucetAddr,
    abi: FAUCET_ABI,
    functionName: "owner",
  })) as Hex;
  if (finalOwner.toLowerCase() !== safeAddr.toLowerCase()) {
    throw new Error(`Faucet owner mismatch: ${finalOwner} != ${safeAddr}`);
  }
  console.log(`[deploy-faucet] Faucet.owner() == Safe ✓`);

  // ----- 3. Update deployments json -----
  dep.contracts.Faucet = faucetAddr;
  dep.arbiscan = dep.arbiscan ?? {};
  dep.arbiscan.Faucet = `${ARBISCAN_BASE}/address/${faucetAddr}`;
  dep.notes = dep.notes ?? {};
  if (transferTx) dep.notes["f7_faucet_ownership_transfer_tx"] = transferTx;
  dep.ownership = dep.ownership ?? {};
  dep.ownership.contracts = dep.ownership.contracts ?? {};
  dep.ownership.contracts.Faucet = {
    address: faucetAddr,
    previousOwner: account.address,
    currentOwner: safeAddr,
    transferTx: transferTx ?? dep.ownership.contracts.Faucet?.transferTx ?? "",
  };
  writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
  console.log(`[deploy-faucet] deployments json updated`);

  // ----- 4. Verify on Arbiscan -----
  console.log(`[deploy-faucet] verifying Faucet on Arbiscan...`);
  const ctorArgsHex = encodeAbiParameters(
    [{type: "address"}, {type: "address"}],
    [tusdcAddr, account.address],
  );
  verifyOnArbiscan(faucetAddr, "src/Faucet.sol", "Faucet", ctorArgsHex);

  console.log(`\n[deploy-faucet] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[deploy-faucet] Faucet: ${faucetAddr}`);
  console.log(`[deploy-faucet] ${ARBISCAN_BASE}/address/${faucetAddr}`);
  console.log(`[deploy-faucet] Safe:   ${safeAddr}`);
  console.log(``);
  console.log(`[deploy-faucet] NEXT STEP — multisig top-up via Safe UI:`);
  console.log(`    Target:   TestUSDC (${tusdcAddr})`);
  console.log(`    Function: mint(address to, uint256 amount)`);
  console.log(`    to:       ${faucetAddr}`);
  console.log(`    amount:   10000000000000  (10M TestUSDC at 6 decimals)`);
}

main().catch((e) => {
  console.error("[deploy-faucet] FAILED:", e);
  process.exit(1);
});

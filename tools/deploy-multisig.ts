// SPDX-License-Identifier: MIT
//
// F4.5 — Multisig governance migration.
//
// Deploys a 2-of-3 Gnosis Safe v1.4.1 on Arbitrum Sepolia and transfers
// ownership of every Ownable contract from the deployer EOA to the Safe.
//
// Reads:  .env (DEPLOYER_PRIVATE_KEY, ARB_SEPOLIA_RPC_URL,
//         MULTISIG_SIGNER_2_PK, MULTISIG_SIGNER_3_PK)
// Writes: contracts/deployments/arb-sepolia.json (in-place, with safe + owner annotations)
//
// Per PRD §3.4: "Admin override via 2/3 multisig" — see also
// KNOWN_LIMITATIONS.md "Admin centralization (resolved in F4.5)".
//
// Prereq: F4 deploy artifacts must exist in contracts/deployments/arb-sepolia.json.

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  getAddress,
  parseAbi,
  type Address,
} from "viem";
import {arbitrumSepolia} from "viem/chains";
import {privateKeyToAccount} from "viem/accounts";
import Safe from "@safe-global/protocol-kit";
import fs from "node:fs/promises";
import path from "node:path";

const DEPLOYMENTS_PATH = path.resolve(process.cwd(), "contracts/deployments/arb-sepolia.json");

const OWNABLE_KEYS = [
  "TestUSDC",
  "MarketRegistry",
  "ResolutionOracle",
  "AdminOracle",
  "PreResolvedOracle",
  "ChainlinkPriceOracle",
  "FeeVault",
] as const;

const OWNABLE_ABI = parseAbi([
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner) external",
]);

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const t0 = Date.now();
  const RPC = need("ARB_SEPOLIA_RPC_URL");
  const PK1 = need("DEPLOYER_PRIVATE_KEY") as `0x${string}`;
  const PK2 = need("MULTISIG_SIGNER_2_PK") as `0x${string}`;
  const PK3 = need("MULTISIG_SIGNER_3_PK") as `0x${string}`;

  const deployer = privateKeyToAccount(PK1);
  const signer2 = privateKeyToAccount(PK2);
  const signer3 = privateKeyToAccount(PK3);

  const owners = [deployer.address, signer2.address, signer3.address];
  const threshold = 2;

  const pub = createPublicClient({chain: arbitrumSepolia, transport: http(RPC)});
  const wc = createWalletClient({chain: arbitrumSepolia, transport: http(RPC), account: deployer});

  const balance = await pub.getBalance({address: deployer.address});
  console.log(`[F4.5] deployer ${deployer.address} balance=${formatEther(balance)} ETH`);
  if (balance < 30_000_000_000_000_000n) {
    throw new Error("deployer balance < 0.03 ETH; top up before continuing");
  }

  console.log(`[F4.5] signers:`);
  console.log(`         #1 ${deployer.address}  (deployer EOA)`);
  console.log(`         #2 ${signer2.address}  (fresh)`);
  console.log(`         #3 ${signer3.address}  (fresh)`);
  console.log(`[F4.5] threshold: ${threshold}-of-${owners.length}`);

  // ----- 1. Deploy Safe -----
  const saltNonce = "0x" + Date.now().toString(16).padStart(64, "0");
  console.log(`\n[F4.5] initializing Safe Protocol Kit (saltNonce=${saltNonce})...`);
  const protocolKit = await Safe.init({
    provider: RPC,
    signer: PK1,
    predictedSafe: {
      safeAccountConfig: {owners, threshold},
      safeDeploymentConfig: {saltNonce, safeVersion: "1.4.1", deploymentType: "canonical"},
    },
  });

  const predictedAddress = await protocolKit.getAddress();
  console.log(`[F4.5] predicted Safe address: ${predictedAddress}`);

  const deployTx = await protocolKit.createSafeDeploymentTransaction();
  console.log(`[F4.5] sending Safe deployment tx...`);
  const txHash = await wc.sendTransaction({
    to: deployTx.to as Address,
    data: deployTx.data as `0x${string}`,
    value: BigInt(deployTx.value ?? "0"),
  });
  const rc = await pub.waitForTransactionReceipt({hash: txHash});
  if (rc.status !== "success") throw new Error(`Safe deployment tx ${txHash} failed`);
  console.log(`[F4.5] Safe deployed in tx ${txHash}, block ${rc.blockNumber}`);

  // Re-init connected to the now-deployed Safe so subsequent reads work.
  const safeSdk = await Safe.init({provider: RPC, signer: PK1, safeAddress: predictedAddress});
  const onchainOwners = await safeSdk.getOwners();
  const onchainThreshold = await safeSdk.getThreshold();
  console.log(`[F4.5] on-chain owners: ${JSON.stringify(onchainOwners)}`);
  console.log(`[F4.5] on-chain threshold: ${onchainThreshold}`);
  if (onchainOwners.length !== owners.length || onchainThreshold !== threshold) {
    throw new Error("Safe owners/threshold mismatch after deploy");
  }

  const safeAddress = getAddress(predictedAddress);

  // ----- 2. Read F4 deployments file -----
  const dep = JSON.parse(await fs.readFile(DEPLOYMENTS_PATH, "utf8"));
  const contracts = dep.contracts as Record<string, string>;

  const previousOwner = getAddress(deployer.address);
  const transfers: {
    name: string;
    address: Address;
    ownerBefore: Address;
    ownerAfter: Address;
    tx: `0x${string}`;
  }[] = [];

  // ----- 3. transferOwnership for each Ownable -----
  for (const key of OWNABLE_KEYS) {
    const addrRaw = contracts[key];
    if (!addrRaw) {
      console.warn(`[F4.5] WARN: ${key} not in deployments json — skipping`);
      continue;
    }
    const addr = getAddress(addrRaw);
    const ownerBefore = (await pub.readContract({
      address: addr,
      abi: OWNABLE_ABI,
      functionName: "owner",
    })) as Address;

    if (ownerBefore.toLowerCase() === safeAddress.toLowerCase()) {
      console.log(`[F4.5] ${key} already owned by Safe — skipping`);
      transfers.push({
        name: key,
        address: addr,
        ownerBefore,
        ownerAfter: safeAddress,
        tx: "0x" as `0x${string}`,
      });
      continue;
    }
    if (ownerBefore.toLowerCase() !== previousOwner.toLowerCase()) {
      throw new Error(
        `${key} (${addr}) is owned by ${ownerBefore}, not the deployer ${previousOwner}; cannot transfer`,
      );
    }

    console.log(`[F4.5] transferring ${key} (${addr}) ${ownerBefore} -> ${safeAddress}...`);
    const txh = await wc.writeContract({
      address: addr,
      abi: OWNABLE_ABI,
      functionName: "transferOwnership",
      args: [safeAddress],
    });
    const r = await pub.waitForTransactionReceipt({hash: txh});
    if (r.status !== "success") throw new Error(`transferOwnership tx ${txh} for ${key} failed`);

    const ownerAfter = (await pub.readContract({
      address: addr,
      abi: OWNABLE_ABI,
      functionName: "owner",
    })) as Address;
    if (ownerAfter.toLowerCase() !== safeAddress.toLowerCase()) {
      throw new Error(`${key} owner is ${ownerAfter} after transfer, expected ${safeAddress}`);
    }
    console.log(`[F4.5] ${key} owner now ${ownerAfter} (tx ${txh})`);
    transfers.push({name: key, address: addr, ownerBefore, ownerAfter, tx: txh});
  }

  // ----- 4. Write deployments json -----
  dep.safe = {
    address: safeAddress,
    version: "1.4.1",
    threshold,
    signers: owners.map((a) => getAddress(a)),
    saltNonce,
    deploymentTx: txHash,
    safeUiUrl: `https://app.safe.global/?safe=arb-sep:${safeAddress}`,
  };
  dep.ownership = {
    previousOwner,
    currentOwner: safeAddress,
    contracts: Object.fromEntries(
      transfers.map((t) => [
        t.name,
        {
          address: getAddress(t.address),
          previousOwner: t.ownerBefore,
          currentOwner: t.ownerAfter,
          transferTx: t.tx,
        },
      ]),
    ),
  };
  await fs.writeFile(DEPLOYMENTS_PATH, JSON.stringify(dep, null, 2) + "\n");
  console.log(`[F4.5] deployments file updated: ${DEPLOYMENTS_PATH}`);

  console.log(`\n[F4.5] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[F4.5] Safe:    ${safeAddress}`);
  console.log(`[F4.5] Safe UI: https://app.safe.global/?safe=arb-sep:${safeAddress}`);
}

main().catch((e) => {
  console.error("[F4.5] FAILED:", e);
  process.exit(1);
});

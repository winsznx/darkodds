/**
 * P0 Day 0 — Nox infrastructure validation gate (revised v1.2).
 *
 * Validates *infrastructure reachability* per PRD v1.2 §11 P0:
 *   1. Arbitrum Sepolia RPC reachable, returns chainId 421614
 *   2. createViemHandleClient constructs cleanly
 *   3. encryptInput round-trip to the Handle Gateway returns a chainId-bound handle + proof
 *   4. Nox protocol contract has bytecode at the SDK-configured address
 *   5. Nox subgraph responds to a trivial GraphQL introspection query
 *
 * Does NOT call decrypt() or viewACL() — those require an on-chain `fromExternal`
 * commit that doesn't happen until Phase F2. See PRD v1.2 §6.0 for the
 * two-stage handle lifecycle this gate is shaped around.
 */

import { createWalletClient, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { createViemHandleClient } from "@iexec-nox/handle";

const ARB_SEPOLIA_CHAIN_ID = 421614;
const DEFAULT_RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
const TEST_VALUE = 42n;
const SOLIDITY_TYPE = "uint256" as const;

/**
 * Source-inspected from `@iexec-nox/handle@0.1.0-beta.10` —
 * `src/config/networks.ts:9-15`. Not part of the public export surface (see
 * `src/index.ts`), so we mirror the values here. If the SDK ever changes them,
 * this script will catch it at the bytecode/introspection step rather than
 * silently drifting. See BUG_LOG entry "[P0] SDK has no public network-config
 * introspection".
 */
const NOX_NETWORK = {
  gatewayUrl:
    "https://2e1800fc0dddeeadc189283ed1dce13c1ae28d48-3000.apps.ovh-tdx-dev.noxprotocol.dev",
  smartContractAddress: "0xd464B198f06756a1d00be223634b85E0a731c229",
  subgraphUrl:
    "https://thegraph.arbitrum-sepolia-testnet.noxprotocol.io/api/subgraphs/id/BjQAX2HpmsSAzURJimKDhjZZnkSJtaczA8RPumggrStb",
} as const;

type StepName = "rpc" | "client" | "encrypt" | "nox-code" | "subgraph";

type StepResult = {
  step: StepName;
  status: "PASS" | "FAIL";
  latencyMs: number;
  detail: string;
};

const results: StepResult[] = [];

async function timed<T>(step: StepName, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const out = await fn();
    const latencyMs = Math.round(performance.now() - start);
    results.push({ step, status: "PASS", latencyMs, detail: "ok" });
    return out;
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    results.push({ step, status: "FAIL", latencyMs, detail });
    throw err;
  }
}

function printSummary(totalMs: number): void {
  const header = ["STEP".padEnd(10), "STATUS".padEnd(7), "LATENCY".padEnd(10), "DETAIL"].join(" | ");
  const sep = "-".repeat(header.length);
  console.log("\n" + sep);
  console.log(header);
  console.log(sep);
  for (const r of results) {
    console.log(
      [
        r.step.padEnd(10),
        r.status.padEnd(7),
        `${r.latencyMs}ms`.padEnd(10),
        r.detail.length > 80 ? r.detail.slice(0, 77) + "..." : r.detail,
      ].join(" | "),
    );
  }
  console.log(sep);
  console.log(`Total round-trip: ${totalMs}ms`);
  console.log(sep + "\n");
}

async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<{ result?: unknown; error?: { message: string } }> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  return (await res.json()) as { result?: unknown; error?: { message: string } };
}

async function main(): Promise<void> {
  const rpcUrl = process.env["ARB_SEPOLIA_RPC_URL"]?.trim() || DEFAULT_RPC_URL;
  const privateKey: Hex = (process.env["HEALTHCHECK_PRIVATE_KEY"]?.trim() as Hex) || generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  console.log(`[healthcheck] RPC:           ${rpcUrl}`);
  console.log(`[healthcheck] Chain:         arbitrumSepolia (${ARB_SEPOLIA_CHAIN_ID})`);
  console.log(`[healthcheck] Account:       ${account.address} (ephemeral)`);
  console.log(`[healthcheck] Nox contract:  ${NOX_NETWORK.smartContractAddress}`);
  console.log(`[healthcheck] Gateway:       ${NOX_NETWORK.gatewayUrl}`);
  console.log(`[healthcheck] Subgraph:      ${NOX_NETWORK.subgraphUrl}`);
  console.log(`[healthcheck] Encrypt value: ${TEST_VALUE} as ${SOLIDITY_TYPE}\n`);

  const overallStart = performance.now();

  // Step 1: RPC reachability + chainId match.
  await timed("rpc", async () => {
    const json = await rpcCall(rpcUrl, "eth_chainId", []);
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    const chainId = parseInt((json.result as string) ?? "0x0", 16);
    if (chainId !== ARB_SEPOLIA_CHAIN_ID) {
      throw new Error(`Expected chainId ${ARB_SEPOLIA_CHAIN_ID}, got ${chainId}`);
    }
  });

  // Step 2: Construct Nox handle client over Viem.
  const handleClient = await timed("client", async () => {
    const walletClient = createWalletClient({
      account,
      chain: arbitrumSepolia,
      transport: http(rpcUrl),
    });
    return createViemHandleClient(walletClient);
  });

  // Step 3: encryptInput → handle gateway round-trip. Validates handle shape
  // and that the gateway issued a chainId-bound handle for Arb Sepolia.
  const { handle, handleProof } = await timed("encrypt", async () => {
    const out = await handleClient.encryptInput(TEST_VALUE, SOLIDITY_TYPE, account.address);
    if (!out.handle || typeof out.handle !== "string" || !out.handle.startsWith("0x") || out.handle.length !== 66) {
      throw new Error(`encryptInput returned malformed handle: ${JSON.stringify(out.handle)}`);
    }
    // Handle layout per `@iexec-nox/handle/src/utils/types.ts` (handleToChainId):
    //   byte 0       = version
    //   bytes 1..4   = chainId (uint32, big-endian)
    //   byte 5       = solidityType code
    //   byte 6       = attribute (reserved)
    //   bytes 7..31  = ciphertext identifier
    // After the "0x" prefix, the chainId nibbles are at indices 4..12.
    const chainIdNibbles = out.handle.slice(4, 12);
    const handleChainId = parseInt(chainIdNibbles, 16);
    if (handleChainId !== ARB_SEPOLIA_CHAIN_ID) {
      throw new Error(
        `Handle chainId mismatch: expected ${ARB_SEPOLIA_CHAIN_ID} (0x66eee), got ${handleChainId} (0x${chainIdNibbles})`,
      );
    }
    if (!out.handleProof || !out.handleProof.startsWith("0x") || out.handleProof.length < 130) {
      throw new Error(`encryptInput returned malformed proof (length=${out.handleProof?.length ?? 0})`);
    }
    return out;
  });

  // Step 4: Nox protocol contract bytecode reachability.
  let noxCodeLen = 0;
  await timed("nox-code", async () => {
    const json = await rpcCall(rpcUrl, "eth_getCode", [NOX_NETWORK.smartContractAddress, "latest"]);
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    const code = (json.result as string) ?? "0x";
    if (typeof code !== "string" || !code.startsWith("0x")) {
      throw new Error(`eth_getCode returned malformed value: ${JSON.stringify(code)}`);
    }
    if (code.length <= 2) {
      throw new Error(
        `Nox protocol contract has no bytecode at ${NOX_NETWORK.smartContractAddress} on chainId ${ARB_SEPOLIA_CHAIN_ID}`,
      );
    }
    noxCodeLen = code.length;
  });

  // Step 5: Subgraph reachability via GraphQL introspection.
  let subgraphQueryTypeName = "";
  await timed("subgraph", async () => {
    const res = await fetch(NOX_NETWORK.subgraphUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ __schema { queryType { name } } }" }),
    });
    if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: { __schema?: { queryType?: { name?: string } } };
      errors?: Array<{ message: string }>;
    };
    if (body.errors?.length) {
      throw new Error(`Subgraph GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    const name = body.data?.__schema?.queryType?.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`Subgraph introspection missing data.__schema.queryType.name: ${JSON.stringify(body)}`);
    }
    subgraphQueryTypeName = name;
  });

  const totalMs = Math.round(performance.now() - overallStart);

  console.log(`[healthcheck] handle:           ${handle}`);
  console.log(`[healthcheck] proofLen:         ${handleProof.length} chars`);
  console.log(`[healthcheck] nox bytecode len: ${noxCodeLen} chars`);
  console.log(`[healthcheck] subgraph schema:  queryType.name = "${subgraphQueryTypeName}"`);

  printSummary(totalMs);
  console.log("GREEN — Nox infra validated, ready for Phase F1");
}

main().catch((err) => {
  const totalMs = results.reduce((acc, r) => acc + r.latencyMs, 0);
  printSummary(totalMs);
  console.error(`\n[healthcheck] FATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  console.error("RED — see BUG_LOG.md");
  process.exit(1);
});

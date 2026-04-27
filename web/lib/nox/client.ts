/**
 * Nox SDK wrapper — single source of truth for @iexec-nox/handle in DarkOdds.
 *
 * Two flavors split across `client.ts` (server-safe, this file) and
 * `client-hook.ts` (browser-only React hook):
 *
 *   1. `getReadOnlyNoxClient()` (this file) — server-or-client, ephemeral
 *      key. Use for `publicDecrypt(handle)` on handles marked
 *      `Nox.allowPublicDecryption` (e.g. `Market.yesPoolPublishedHandle()`
 *      after a batch publish). `publicDecrypt` doesn't require any
 *      specific signer's identity — anyone can decrypt a public handle by
 *      submitting it to the gateway. We give the SDK a fresh ephemeral
 *      viem `WalletClient` purely to satisfy its constructor; the key
 *      never signs anything material.
 *
 *   2. `useNoxClient()` (in `client-hook.ts`) — React hook for browser-side
 *      use bound to the connected Privy/wagmi wallet. Use for `encryptInput`
 *      (signs the gateway request for handle ACL) and `decrypt(handle)`
 *      (requires user has viewer ACL on the handle).
 *
 * Bundle: `@iexec-nox/handle` is ~350 KB unpacked. Loads only into the
 * (dashboard) route group — landing page stays clean. Exact gzip impact
 * measured at F9 HALT 4.
 */

import {createViemHandleClient, type HandleClient} from "@iexec-nox/handle";
import {createWalletClient, http} from "viem";
import {generatePrivateKey, privateKeyToAccount} from "viem/accounts";

import {ARB_SEPOLIA_RPC_URL, chain} from "@/lib/chains";

// ────────────────────────────────────────────────────────────────────────────
// Read-only client (ephemeral key) — for publicDecrypt of public handles.
// Memoized at module scope so successive calls reuse the same SDK instance.
// ────────────────────────────────────────────────────────────────────────────

let readOnlyClientPromise: Promise<HandleClient> | null = null;

export async function getReadOnlyNoxClient(): Promise<HandleClient> {
  if (!readOnlyClientPromise) {
    readOnlyClientPromise = (async () => {
      const ephAccount = privateKeyToAccount(generatePrivateKey());
      const ephWallet = createWalletClient({
        account: ephAccount,
        chain,
        transport: http(ARB_SEPOLIA_RPC_URL),
      });
      return createViemHandleClient(ephWallet);
    })();
  }
  return readOnlyClientPromise;
}

/**
 * Best-effort plaintext value via `publicDecrypt`. Returns null on any
 * failure (gateway 5xx, network, malformed handle, ACL miss). Caller is
 * responsible for falling back to a redaction-bar UI.
 */
export async function tryPublicDecryptUint256(handle: `0x${string}`): Promise<bigint | null> {
  try {
    const client = await getReadOnlyNoxClient();
    const out = await client.publicDecrypt(handle);
    return typeof out.value === "bigint" ? out.value : null;
  } catch {
    return null;
  }
}

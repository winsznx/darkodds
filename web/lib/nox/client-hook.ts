"use client";

import {useEffect, useState} from "react";

import {createViemHandleClient, type HandleClient} from "@iexec-nox/handle";
import {useWallets, type ConnectedWallet} from "@privy-io/react-auth";
import type {Hex} from "viem";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";

import {ARB_SEPOLIA_RPC_URL, chain} from "@/lib/chains";

interface NoxClientState {
  client: HandleClient | null;
  ready: boolean;
  error: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// safeDecrypt — serialized first-decrypt to prevent N parallel auth signatures
//
// The Nox SDK's `decrypt(handle)` (see
// `node_modules/@iexec-nox/handle/src/methods/decrypt.ts`) checks
// `localStorage` for cached `DataAccessAuthorization` material. If absent, it
// generates a fresh RSA keypair, asks the wallet to sign an EIP-712 typed
// data message, and caches the result for 1 hour. All subsequent decrypts
// for the same (user, chain, verifyingContract) reuse the cached auth.
//
// When N components mount in parallel and each call `decrypt()`, all N hit
// the storage check before any has stored material — classic TOCTOU race —
// resulting in N parallel signature popups. MetaMask queues them as
// "1 of N"; Privy embedded wallet auto-signs them silently (which is why F9
// looked clean during the bet smoke).
//
// Fix: serialize the FIRST decrypt per wallet. Once it completes, storage is
// populated and subsequent calls run in parallel without any extra
// signature. Tracks per-wallet so a disconnect+reconnect of a different
// wallet correctly re-acquires auth.
// ─────────────────────────────────────────────────────────────────────────────

const decryptUnlocked = new Set<string>();
const decryptInFlightByWallet = new Map<string, Promise<unknown>>();

export async function safeDecrypt(
  client: HandleClient,
  handle: Hex,
  walletAddress: string,
): Promise<{value: unknown; solidityType: string}> {
  const key = walletAddress.toLowerCase();

  if (decryptUnlocked.has(key)) {
    return client.decrypt(handle) as Promise<{value: unknown; solidityType: string}>;
  }

  const inFlight = decryptInFlightByWallet.get(key);
  if (inFlight) {
    await inFlight.catch(() => undefined);
    return client.decrypt(handle) as Promise<{value: unknown; solidityType: string}>;
  }

  const p = client.decrypt(handle);
  decryptInFlightByWallet.set(key, p);
  try {
    const result = (await p) as {value: unknown; solidityType: string};
    decryptUnlocked.add(key);
    return result;
  } finally {
    if (decryptInFlightByWallet.get(key) === p) {
      decryptInFlightByWallet.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level singleton — every `createViemHandleClient(walletClient)` call
// triggers a Nox `DataAccessAuthorization` typed-data signature against the
// connected wallet. Mounting N components that each call useNoxClient() /
// useBetClients() creates N parallel signature requests, which MetaMask
// queues as separate popups (Privy embedded auto-signs them silently —
// hence why F9 looked clean during the bet smoke).
//
// The fix: cache the client instance per wallet address. First call
// initializes; subsequent calls reuse the in-flight promise (so concurrent
// hook mounts don't race to create N clients) and then the cached client.
//
// The cache is invalidated when the connected wallet address changes.
// ─────────────────────────────────────────────────────────────────────────────

interface ClientBundle {
  address: string;
  walletClient: WalletClient;
  noxClient: HandleClient;
}

let cached: ClientBundle | null = null;
let inFlight: {address: string; promise: Promise<ClientBundle>} | null = null;

async function getOrCreateClients(wallet: ConnectedWallet): Promise<ClientBundle> {
  const address = wallet.address.toLowerCase();

  if (cached && cached.address !== address) {
    cached = null;
    inFlight = null;
  }
  if (cached && cached.address === address) return cached;
  if (inFlight && inFlight.address === address) return inFlight.promise;

  const promise = (async (): Promise<ClientBundle> => {
    const provider = await wallet.getEthereumProvider();
    const walletClient = createWalletClient({
      chain,
      transport: custom(provider),
      account: wallet.address as `0x${string}`,
    });
    const noxClient = await createViemHandleClient(walletClient);
    const bundle: ClientBundle = {address, walletClient, noxClient};
    cached = bundle;
    inFlight = null;
    return bundle;
  })();

  inFlight = {address, promise};
  return promise;
}

/**
 * Returns a Nox SDK instance bound to the connected user's wallet, suitable
 * for `encryptInput` (signs gateway requests for handle ACL grants) and
 * `decrypt` (requires viewer ACL on the handle).
 *
 * Backed by a module-level singleton keyed by wallet address — only the FIRST
 * caller per session triggers the Nox auth signature; subsequent callers
 * reuse the cached client. See module preamble above for context.
 */
export function useNoxClient(): NoxClientState {
  const {wallets} = useWallets();
  const [state, setState] = useState<NoxClientState>({client: null, ready: false, error: null});

  useEffect(() => {
    let cancelled = false;
    const wallet = wallets[0];
    if (!wallet) {
      const t = setTimeout(() => {
        if (!cancelled) setState({client: null, ready: false, error: null});
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    void getOrCreateClients(wallet)
      .then((bundle) => {
        if (cancelled) return;
        setState({client: bundle.noxClient, ready: true, error: null});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({client: null, ready: false, error: message});
      });

    return () => {
      cancelled = true;
    };
  }, [wallets]);

  return state;
}

// ────────────────────────────────────────────────────────────────────────────
// Bet/claim flow client bundle — orchestrators (lib/bet/place-bet.ts,
// lib/claim/run-claim.ts) need walletClient + publicClient + noxClient. All
// three resolve from the singleton above (modulo publicClient which is
// stateless and shared at module scope).
// ────────────────────────────────────────────────────────────────────────────

export interface BetClients {
  walletClient: WalletClient | null;
  publicClient: PublicClient;
  noxClient: HandleClient | null;
  ready: boolean;
  error: string | null;
}

const sharedPublicClient = createPublicClient({
  chain,
  transport: http(ARB_SEPOLIA_RPC_URL),
});

export function useBetClients(): BetClients {
  const {wallets} = useWallets();
  const [state, setState] = useState<{
    walletClient: WalletClient | null;
    noxClient: HandleClient | null;
    error: string | null;
  }>({walletClient: null, noxClient: null, error: null});

  useEffect(() => {
    let cancelled = false;
    const wallet = wallets[0];
    if (!wallet) {
      const t = setTimeout(() => {
        if (!cancelled) setState({walletClient: null, noxClient: null, error: null});
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }

    void getOrCreateClients(wallet)
      .then((bundle) => {
        if (cancelled) return;
        setState({walletClient: bundle.walletClient, noxClient: bundle.noxClient, error: null});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({walletClient: null, noxClient: null, error: message});
      });

    return () => {
      cancelled = true;
    };
  }, [wallets]);

  return {
    walletClient: state.walletClient,
    publicClient: sharedPublicClient,
    noxClient: state.noxClient,
    ready: state.walletClient !== null && state.noxClient !== null,
    error: state.error,
  };
}

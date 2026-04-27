"use client";

import {useEffect, useState} from "react";

import {createViemHandleClient, type HandleClient} from "@iexec-nox/handle";
import {useWallets} from "@privy-io/react-auth";
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

/**
 * Returns a Nox SDK instance bound to the connected user's wallet, suitable
 * for `encryptInput` (signs gateway requests for handle ACL grants) and
 * `decrypt` (requires viewer ACL on the handle).
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

    void (async () => {
      try {
        const provider = await wallet.getEthereumProvider();
        const walletClient = createWalletClient({
          chain,
          transport: custom(provider),
          account: wallet.address as `0x${string}`,
        });
        const client = await createViemHandleClient(walletClient);
        if (!cancelled) setState({client, ready: true, error: null});
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState({client: null, ready: false, error: message});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallets]);

  return state;
}

// ────────────────────────────────────────────────────────────────────────────
// Bet-flow client bundle — the orchestrator (lib/bet/place-bet.ts) needs all
// three: noxClient (for SDK encryptInput), walletClient (for tx submission via
// viem), publicClient (for chain reads + tx receipts). All wired against the
// connected Privy wallet's EIP-1193 provider.
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

    void (async () => {
      try {
        const provider = await wallet.getEthereumProvider();
        const walletClient = createWalletClient({
          chain,
          transport: custom(provider),
          account: wallet.address as `0x${string}`,
        });
        const noxClient = await createViemHandleClient(walletClient);
        if (!cancelled) setState({walletClient, noxClient, error: null});
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setState({walletClient: null, noxClient: null, error: message});
        }
      }
    })();

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

"use client";

import {useEffect, useState} from "react";

import {createViemHandleClient, type HandleClient} from "@iexec-nox/handle";
import {useWallets} from "@privy-io/react-auth";
import {createWalletClient, custom} from "viem";

import {chain} from "@/lib/chains";

interface NoxClientState {
  client: HandleClient | null;
  ready: boolean;
  error: string | null;
}

/**
 * Returns a Nox SDK instance bound to the connected user's wallet, suitable
 * for `encryptInput` (signs gateway requests for handle ACL grants) and
 * `decrypt` (requires viewer ACL on the handle).
 *
 * Resolves to `{client: null, ready: false}` until a wallet is available.
 * Caller must check `ready` before invoking client methods.
 */
export function useNoxClient(): NoxClientState {
  const {wallets} = useWallets();
  const [state, setState] = useState<NoxClientState>({client: null, ready: false, error: null});

  useEffect(() => {
    let cancelled = false;
    const wallet = wallets[0];
    if (!wallet) {
      // Defer the reset to a fresh microtask — React 19's set-state-in-effect
      // rule fires on synchronous setState in effect bodies even for the
      // "drop to defaults" pattern. setTimeout(0) keeps semantics identical.
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
        // Privy gives us an EIP-1193 provider; viem's `custom` transport
        // wraps it so the SDK's signTypedData/getAddress flows route to
        // Privy's wallet, including embedded-wallet users-without-wallets.
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

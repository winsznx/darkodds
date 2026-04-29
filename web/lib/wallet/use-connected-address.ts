"use client";

import {useMemo} from "react";

import {usePrivy, useWallets} from "@privy-io/react-auth";

/**
 * Single source of truth for "the connected user's Ethereum address."
 *
 * Returns `undefined` until Privy has hydrated AND the user is authenticated
 * AND a wallet is available. Always reads from Privy's `useWallets()` rather
 * than wagmi's `useAccount().address` because the wagmi ↔ Privy connector
 * handshake is asynchronous: on first sign-in (especially Privy email-auth
 * with auto-provisioned embedded wallet), `usePrivy().ready === true`
 * lights up several hundred ms before `useAccount().address` reflects the
 * embedded wallet, leaving topbar / faucet / portfolio components with
 * `address === undefined` until the next render that happens to coincide
 * with the connector finishing. A page refresh papered over the symptom
 * because by then Privy was authenticated synchronously.
 *
 * Privy's `useWallets()` reads directly from the embedded provider state
 * which is synchronous-on-ready, so this hook returns the right address
 * the moment Privy reports `ready && authenticated`. wagmi's other hooks
 * (`useBalance`, `useReadContract`, `useWriteContract`) accept the address
 * as a parameter and refetch when it changes, so this single change
 * propagates the fix without touching their call sites.
 *
 * Usage:
 *   const address = useConnectedAddress();
 *   if (!address) return null; // not yet ready, or not authenticated
 *
 * Affects the visible topbar address pill, FaucetModal balance check,
 * /portfolio user-bet decryption, /create wallet detection (sponsored vs
 * self-sign branch), and any future feature that gates on connectedAddress.
 */
export function useConnectedAddress(): `0x${string}` | undefined {
  const {ready, authenticated} = usePrivy();
  const {wallets} = useWallets();
  return useMemo(() => {
    if (!ready || !authenticated) return undefined;
    const addr = wallets[0]?.address;
    if (typeof addr !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return undefined;
    return addr as `0x${string}`;
  }, [ready, authenticated, wallets]);
}

"use client";

import {useEffect, useState} from "react";

import {createPublicClient, decodeEventLog, http, parseAbi, type Address, type Hex} from "viem";
import {arbitrumSepolia} from "viem/chains";

import {ARB_SEPOLIA_RPC_URL} from "@/lib/chains";
import {addresses} from "@/lib/contracts/addresses";

// Match Market.sol exactly — IMarket.sol:43 declares BOTH `user` AND `batchId`
// as `indexed`. viem's decodeEventLog slices topics vs data based on the
// indexed flags; getting them wrong = silent decode failure (zero results).
const BET_PLACED_ABI = parseAbi([
  "event BetPlaced(address indexed user, uint8 side, bytes32 handle, uint256 indexed batchId)",
]);

// Used to find the block the market was created at, so we don't have to scan
// the entire chain (or guess a window).
const MARKET_CREATED_ABI = parseAbi([
  "event MarketCreated(uint256 indexed id, address market, string question, uint256 expiryTs)",
]);

interface EventLogProps {
  marketAddress: Address;
  marketId: bigint;
  /** Bumped by the parent after a successful bet to refetch event log. */
  refreshNonce?: number;
}

interface BetEvent {
  txHash: Hex;
  user: Address;
  side: number;
  batchId: bigint;
  blockNumber: bigint;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function EventLog({marketAddress, marketId, refreshNonce = 0}: EventLogProps): React.ReactElement {
  const [events, setEvents] = useState<BetEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pub = createPublicClient({chain: arbitrumSepolia, transport: http(ARB_SEPOLIA_RPC_URL)});
    void (async () => {
      try {
        // Find the market's creation block by filtering MarketCreated on the
        // registry by this id (indexed → cheap topic filter). Cheaper and
        // more correct than guessing a fromBlock window — F4 markets are
        // millions of blocks back on Arb Sepolia.
        let fromBlock = BigInt(0);
        try {
          const created = await pub.getLogs({
            address: addresses.MarketRegistry,
            event: MARKET_CREATED_ABI[0],
            args: {id: marketId},
            fromBlock: BigInt(0),
            toBlock: "latest",
          });
          if (created.length > 0) fromBlock = created[0]!.blockNumber;
        } catch {
          // RPC limits range-from-zero on some providers — fall back to a
          // generous 5M-block window (~14 days on Arb Sepolia).
          const head = await pub.getBlockNumber();
          fromBlock = head > BigInt(5_000_000) ? head - BigInt(5_000_000) : BigInt(0);
        }

        const logs = await pub.getLogs({
          address: marketAddress,
          event: BET_PLACED_ABI[0],
          fromBlock,
          toBlock: "latest",
        });
        if (cancelled) return;
        const decoded: BetEvent[] = [];
        for (const log of logs.slice(-20).reverse()) {
          try {
            const ev = decodeEventLog({abi: BET_PLACED_ABI, data: log.data, topics: log.topics});
            const args = ev.args as {user: Address; side: number; batchId: bigint};
            decoded.push({
              txHash: log.transactionHash,
              user: args.user,
              side: args.side,
              batchId: args.batchId,
              blockNumber: log.blockNumber,
            });
          } catch {
            /* skip malformed */
          }
        }
        setEvents(decoded);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketAddress, marketId, refreshNonce]);

  if (events === null) {
    return (
      <section className="md-eventlog">
        <h2 className="md-section-h">Bet history</h2>
        <p className="md-empty" style={{padding: 16}}>
          LOADING EVENTS…
        </p>
      </section>
    );
  }
  if (events.length === 0) {
    return (
      <section className="md-eventlog">
        <h2 className="md-section-h">Bet history</h2>
        <p className="md-empty" style={{padding: 16}}>
          NO BETS RECORDED YET
        </p>
      </section>
    );
  }
  return (
    <section className="md-eventlog">
      <h2 className="md-section-h">Bet history · {events.length}</h2>
      {events.map((e) => (
        <div key={e.txHash} className="row">
          <span className="addr">{shortAddr(e.user)}</span>
          <span className="side">{e.side === 1 ? "YES" : "NO"}</span>
          <span className="amt">
            <span className="bar" aria-label="amount redacted" />
          </span>
          <span className="ts">BATCH {e.batchId.toString()}</span>
        </div>
      ))}
    </section>
  );
}

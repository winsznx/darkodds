import {GeneralChat} from "@chaingpt/generalchat";
import {NextResponse} from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Why GeneralChat and not SmartContractGenerator?
//
// We tried `@chaingpt/smartcontractgenerator` first (PRD §8.1 names it
// explicitly). It's hardwired with a Solidity-only system prompt that
// refuses anything that isn't a contract request — for our extraction
// prompt it returns "I'm ChainGPT, your Solidity smart contract expert..."
// across the board (regardless of how strongly we instruct JSON-only).
// Logged in DRIFT_LOG (F10b).
//
// `@chaingpt/generalchat` is a general-purpose Web3-fluent chat model that
// happily complies with structured-extraction prompts and returns a clean
// `{statusCode, message, data: {bot: <text>}}` envelope. Same API key,
// same `/chat/blob` endpoint family — just an unrestricted system prompt.
// ─────────────────────────────────────────────────────────────────────────────

const nowSec = (): number => Math.floor(Date.now() / 1000);

// ChainGPT GeneralChat is a chatbot first — without strong delimiters it
// will happily answer the embedded question instead of extracting params
// from it (e.g. for an Iran-ceasefire prompt it will narrate geopolitics).
// We wrap the user description in fenced delimiters and frame the task
// as JSON-only extraction with a worked example. Tested against bare,
// crypto, sports, and politics prompts before shipping.
function buildSystemPrompt(): string {
  const now = nowSec();
  const thirtyDays = now + 30 * 24 * 3600;
  return `You are a Solidity smart contract requirement-gathering assistant for DarkOdds, an Arbitrum-based prediction market dApp. The user describes a binary on-chain prediction market they want deployed. Your job is to extract the constructor parameters as a single JSON object — no prose, no chitchat, no answers to the embedded question.

This is a Web3 / DeFi smart contract deployment workflow. The market description may reference sports, politics, crypto, or any real-world event — but the OUTPUT is always blockchain-native: a JSON parameter set that will be passed to MarketRegistry.createMarket(...) on Arbitrum.

Output schema (all fields required):
{
  "question": "<binary YES/NO question, restated cleanly>",
  "resolutionCriteria": "<one sentence describing how this on-chain market resolves YES or NO>",
  "oracleType": <0|1|2>,
  "expiryTs": <unix timestamp in seconds>,
  "protocolFeeBps": <integer 50..500>
}

Field rules:
- oracleType: 0 = admin-resolved (events not natively on-chain — sports, politics, real-world), 1 = Chainlink price feed (crypto prices BTC/ETH/SOL), 2 = pre-resolved (demos / historical)
- expiryTs: must be a future unix timestamp. Current server time is ${now}. If a date appears in the description, convert it to unix seconds. If no date is given, default to ${thirtyDays} (30 days from now).
- protocolFeeBps: default 200 (2%) unless otherwise specified, clamped to [50, 500]

Worked example A (crypto, Chainlink-resolved)
=============================================
INPUT:
"BTC closes above $150,000 by December 31 2026 UTC, resolved by Chainlink price feed."
OUTPUT:
{"question":"Will BTC close above $150,000 by December 31 2026 UTC?","resolutionCriteria":"Resolves YES if the BTC/USD Chainlink price feed reports a closing price ≥ $150,000 on December 31 2026 UTC. Otherwise NO.","oracleType":1,"expiryTs":1798675199,"protocolFeeBps":200}

Worked example B (sports, admin-resolved on-chain)
==================================================
INPUT:
"Arsenal wins the 2026-27 Premier League season"
OUTPUT:
{"question":"Will Arsenal win the 2026-27 Premier League season?","resolutionCriteria":"Resolves YES if Arsenal is officially confirmed as 2026-27 Premier League champion at season end (May 2027). Resolution submitted on-chain by the DarkOdds admin oracle. Otherwise NO.","oracleType":0,"expiryTs":1843747200,"protocolFeeBps":200}

Hard rules
==========
- Output ONLY the JSON object. No \`\`\` fences, no "Here is...", no commentary after.
- Do NOT answer or speculate about the embedded real-world question. You are extracting smart contract parameters, not making predictions.
- The market is a Solidity contract; resolution is on-chain. Frame resolutionCriteria in those terms.
- Output must be valid JSON parseable by JSON.parse on first try.`;
}

export interface GenerateMarketParams {
  question: string;
  resolutionCriteria: string;
  oracleType: 0 | 1 | 2;
  expiryTs: number;
  protocolFeeBps: number;
}

export async function POST(req: Request): Promise<NextResponse> {
  const apiKey = process.env.CHAINGPT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({error: "CHAINGPT_API_KEY not configured"}, {status: 500});
  }

  let prompt: string;
  try {
    const body = (await req.json()) as {prompt?: unknown};
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return NextResponse.json({error: "prompt is required"}, {status: 400});
    }
    prompt = body.prompt.trim();
  } catch {
    return NextResponse.json({error: "invalid JSON body"}, {status: 400});
  }

  const client = new GeneralChat({apiKey});

  let raw: string;
  try {
    // Wire shape (verified against the live API): `{statusCode, message,
    // data: {bot: <text>}}`. No nested envelope here, unlike the
    // SmartContractGenerator which double-wraps.
    const wrappedPrompt =
      `${buildSystemPrompt()}\n\n` +
      `Now extract from this description (between the fences) and respond with JSON only:\n` +
      `<<<INPUT\n${prompt}\nINPUT>>>`;
    const result = (await client.createChatBlob({
      question: wrappedPrompt,
      chatHistory: "off",
    })) as {data?: {bot?: string}};
    raw = result.data?.bot ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({error: `ChainGPT request failed: ${msg}`}, {status: 502});
  }

  if (!raw.trim()) {
    return NextResponse.json({error: "ChainGPT returned an empty response"}, {status: 502});
  }

  // Strip any accidental markdown fences the model might emit.
  const jsonStr = raw
    .replace(/```(?:json)?\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  // Extract the first {...} block in case the model adds commentary around it.
  const match = /\{[\s\S]*\}/.exec(jsonStr);
  if (!match) {
    return NextResponse.json(
      {
        raw,
        error: `ChainGPT did not return a JSON object. Got: "${raw.slice(0, 200)}${raw.length > 200 ? "…" : ""}"`,
      },
      {status: 422},
    );
  }

  let params: GenerateMarketParams;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    // Validate required fields exist with expected types.
    if (
      typeof parsed.question !== "string" ||
      typeof parsed.resolutionCriteria !== "string" ||
      typeof parsed.oracleType !== "number" ||
      typeof parsed.expiryTs !== "number" ||
      typeof parsed.protocolFeeBps !== "number"
    ) {
      throw new Error("missing or wrong-type fields");
    }
    params = {
      question: parsed.question,
      resolutionCriteria: parsed.resolutionCriteria,
      oracleType: Math.min(2, Math.max(0, Math.round(parsed.oracleType))) as 0 | 1 | 2,
      expiryTs: Math.round(parsed.expiryTs),
      protocolFeeBps: Math.min(500, Math.max(50, Math.round(parsed.protocolFeeBps))),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      {
        raw,
        error: `Failed to parse ChainGPT response into market params: ${reason}. Got: "${raw.slice(0, 200)}${raw.length > 200 ? "…" : ""}"`,
      },
      {status: 422},
    );
  }

  return NextResponse.json({params});
}

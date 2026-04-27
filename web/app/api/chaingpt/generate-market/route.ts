import {SmartContractGenerator} from "@chaingpt/smartcontractgenerator";
import {NextResponse} from "next/server";

const nowSec = (): number => Math.floor(Date.now() / 1000);

// Instruct ChainGPT to act as a structured param extractor, not a raw
// Solidity generator. DarkOdds already has the contracts — we only need
// the market metadata the user described in natural language.
function buildSystemPrompt(): string {
  const now = nowSec();
  const thirtyDays = now + 30 * 24 * 3600;
  return `You are a prediction market parameter extractor for DarkOdds — a confidential on-chain prediction market on Arbitrum.

The user describes a market in natural language. Extract the parameters and return ONLY a valid JSON object.
No markdown fences, no explanations — just the raw JSON.

JSON schema (all fields required):
{
  "question": "A clear binary yes/no question about a future outcome",
  "resolutionCriteria": "Specific, objective criteria for resolving YES or NO",
  "oracleType": 0,         // 0=admin-resolved (sports/events), 1=chainlink-price-feed (crypto prices), 2=pre-resolved
  "expiryTs": ${thirtyDays},  // Unix timestamp (seconds) when the market expires
  "protocolFeeBps": 200    // Protocol fee in basis points (200 = 2%, allowed range 50–500)
}

Rules:
- question must be answerable YES or NO
- For crypto price markets (BTC, ETH, SOL, etc.) use oracleType=1
- For sports, politics, or real-world events use oracleType=0
- expiryTs must be a future Unix timestamp (current server time: ${now})
- If the user specifies a date, convert it accurately to a Unix timestamp
- If expiry is not mentioned, default to 30 days from now (${thirtyDays})
- Default protocolFeeBps to 200 unless the user specifies otherwise`;
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

  const client = new SmartContractGenerator({apiKey});

  let raw: string;
  try {
    const result = (await client.createSmartContractBlob({
      question: `${buildSystemPrompt()}\n\nUser description: ${prompt}`,
      chatHistory: "off",
    })) as {bot?: string};
    raw = result.bot ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({error: `ChainGPT request failed: ${msg}`}, {status: 502});
  }

  // Strip any accidental markdown fences the model might emit.
  const jsonStr = raw
    .replace(/```(?:json)?\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  // Extract the first {...} block in case the model adds commentary around it.
  const match = /\{[\s\S]*\}/.exec(jsonStr);
  if (!match) {
    return NextResponse.json({raw, error: "ChainGPT did not return a JSON object"}, {status: 422});
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
  } catch {
    return NextResponse.json(
      {raw, error: "Failed to parse ChainGPT response into market params"},
      {status: 422},
    );
  }

  return NextResponse.json({params});
}

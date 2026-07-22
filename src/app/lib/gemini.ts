import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  type ChatSession,
} from "firebase/ai";
import { app } from "./firebase";
import type { StockMeta } from "./stocks";

const ai = getAI(app, { backend: new GoogleAIBackend() });

const SYSTEM = `You are Vantage AI, a helpful investing assistant inside the Vantage stock app.
You help users with:
- Stock recommendations and ideas (with clear reasoning)
- Pattern / technical / trend analysis based on data they share
- Explaining markets, sectors, ETFs, and portfolio concepts
- Answering questions about tickers they follow

Rules:
- Be concise and practical. Use short paragraphs or bullets when useful.
- Format with simple markdown: **bold**, bullets, and short headings when helpful.
- Always finish complete sentences and complete every bullet — never cut off mid-thought.
- Always remind users this is not financial advice and markets involve risk.
- Prefer tickers and facts grounded in the portfolio/market context provided.
- If data is missing, say so and ask a clarifying question.
- Do not invent precise live prices; use the provided snapshot when available.
- Aim for clear answers; go longer when the user asks for depth.`;

export interface ChatContext {
  signedIn: boolean;
  watchlistSymbols: string[];
  holdings: { symbol: string; shares: number; avgCost: number }[];
  stocks: Pick<StockMeta, "symbol" | "name" | "sector" | "price" | "changePercent">[];
}

function contextBlock(ctx: ChatContext): string {
  const lines: string[] = [
    `User signed in: ${ctx.signedIn ? "yes" : "no"}`,
    `Watchlist tickers: ${ctx.watchlistSymbols.slice(0, 40).join(", ") || "(none)"}`,
  ];
  if (ctx.holdings.length) {
    lines.push(
      "Holdings: " +
        ctx.holdings
          .slice(0, 20)
          .map(h => `${h.symbol} ${h.shares}@$${h.avgCost.toFixed(2)}`)
          .join("; ")
    );
  } else {
    lines.push("Holdings: (none)");
  }
  if (ctx.stocks.length) {
    lines.push(
      "Market snapshot: " +
        ctx.stocks
          .slice(0, 25)
          .map(s => {
            const pct = Number.isFinite(s.changePercent)
              ? `${s.changePercent >= 0 ? "+" : ""}${s.changePercent.toFixed(2)}%`
              : "—";
            return `${s.symbol} $${s.price.toFixed(2)} ${pct} (${s.sector})`;
          })
          .join("; ")
    );
  }
  return lines.join("\n");
}

let chat: ChatSession | null = null;
let chatContextKey = "";

function ensureChat(ctx: ChatContext): ChatSession {
  const key = JSON.stringify({
    signedIn: ctx.signedIn,
    watchlistSymbols: ctx.watchlistSymbols.slice(0, 40),
    holdings: ctx.holdings.slice(0, 20),
  });
  if (chat && key === chatContextKey) return chat;

  const model = getGenerativeModel(ai, {
    model: "gemini-flash-latest",
    systemInstruction: SYSTEM,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 4096,
    },
  });

  chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: `App context for this session:\n${contextBlock(ctx)}` }],
      },
      {
        role: "model",
        parts: [{
          text: "Got it — I’ll use your watchlists, holdings, and market snapshot when helping. What would you like to explore?",
        }],
      },
    ],
  });
  chatContextKey = key;
  return chat;
}

export function resetChat() {
  chat = null;
  chatContextKey = "";
}

/** Stream a reply; yields incremental full text so far. */
export async function* streamChatReply(
  message: string,
  ctx: ChatContext,
): AsyncGenerator<string> {
  const session = ensureChat(ctx);
  const prompt = `${message}\n\n(Latest app context)\n${contextBlock(ctx)}`;
  const result = await session.sendMessageStream(prompt);
  let full = "";
  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) {
      full += t;
      yield full;
    }
  }
  try {
    const response = await result.response;
    const final = response.text() || "";
    if (final.length > full.length) {
      full = final;
      yield full;
    } else if (!full && final) {
      full = final;
      yield full;
    }
  } catch {
    /* stream already consumed */
  }
  if (!full) yield "I couldn’t generate a reply. Try again.";
}

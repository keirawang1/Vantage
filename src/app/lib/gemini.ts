import { apiUrl } from "./stocks";
import type { StockMeta } from "./stocks";

export interface ChatContext {
  signedIn: boolean;
  watchlistSymbols: string[];
  holdings: { symbol: string; shares: number; avgCost: number }[];
  stocks: Pick<StockMeta, "symbol" | "name" | "sector" | "price" | "changePercent">[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export function resetChat() {
  // History lives in the chat UI; the API is stateless.
}

export function chatErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const lower = raw.toLowerCase();
  if (lower.includes("not configured") || lower.includes("gemini_api_key") || lower.includes("503")) {
    return "Add a free Gemini key: aistudio.google.com/apikey → server env GEMINI_API_KEY (no billing / App Check).";
  }
  if (lower.includes("quota") || lower.includes("resource exhausted") || lower.includes("429")) {
    return "Gemini is rate-limited right now. Try again in a minute.";
  }
  if (lower.includes("api key") || lower.includes("permission") || lower.includes("403")) {
    return "That Gemini API key isn’t valid. Create a free one at aistudio.google.com/apikey.";
  }
  return "Something went wrong. Try again in a moment.";
}

export async function* streamChatReply(
  message: string,
  ctx: ChatContext,
  history: ChatTurn[] = [],
): AsyncGenerator<string> {
  const res = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history: history.slice(-24).map(t => ({ role: t.role, text: t.text })),
      context: {
        signedIn: ctx.signedIn,
        watchlistSymbols: ctx.watchlistSymbols.slice(0, 40),
        holdings: ctx.holdings.slice(0, 20),
        stocks: ctx.stocks.slice(0, 25),
      },
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json() as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? "");
    } catch {
      detail = await res.text().catch(() => "");
    }
    throw new Error(detail || `Chat failed (${res.status})`);
  }
  if (!res.body) throw new Error("Chat failed (empty stream)");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find(l => l.startsWith("data: "));
      if (!line) continue;
      let payload: { t?: string; error?: string; done?: boolean };
      try {
        payload = JSON.parse(line.slice(6)) as { t?: string; error?: string; done?: boolean };
      } catch {
        continue;
      }
      if (payload.error) throw new Error(payload.error);
      if (payload.t) {
        full += payload.t;
        yield full;
      }
    }
  }
  if (!full) yield "I couldn’t generate a reply. Try again.";
}

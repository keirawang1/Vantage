export type AlertAction = "notify" | "buy" | "sell";
export type AlertDirection = "above" | "below";
export type AlertStatus = "pending" | "complete";

export interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  direction: AlertDirection;
  action: AlertAction;
  shares: number;
  status: AlertStatus;
  createdAt: number;
  createdPrice: number;
  triggeredAt?: number;
  triggeredPrice?: number;
}

export interface AppNotification {
  id: string;
  alertId: string;
  symbol: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
  action: AlertAction;
  complete: boolean;
}

export interface AlertHolding {
  symbol: string;
  shares: number;
  avgCost: number;
}

export interface AlertTrade {
  type: "buy" | "sell";
  symbol: string;
  shares: number;
  price: number;
}

const MAX_NOTIFICATIONS = 80;
const MAX_ALERTS = 80;

const fmt$ = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtShares = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 4 });

export function parsePriceAlerts(raw: unknown): PriceAlert[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceAlert[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.symbol !== "string") continue;
    if (typeof a.targetPrice !== "number" || !Number.isFinite(a.targetPrice)) continue;
    const direction = a.direction === "below" ? "below" : a.direction === "above" ? "above" : null;
    const action = a.action === "buy" || a.action === "sell" || a.action === "notify" ? a.action : null;
    const status = a.status === "complete" ? "complete" : a.status === "pending" ? "pending" : null;
    if (!direction || !action || !status) continue;
    out.push({
      id: a.id,
      symbol: a.symbol,
      targetPrice: a.targetPrice,
      direction,
      action,
      shares: typeof a.shares === "number" && Number.isFinite(a.shares) ? a.shares : 0,
      status,
      createdAt: typeof a.createdAt === "number" ? a.createdAt : 0,
      createdPrice: typeof a.createdPrice === "number" ? a.createdPrice : 0,
      triggeredAt: typeof a.triggeredAt === "number" ? a.triggeredAt : undefined,
      triggeredPrice: typeof a.triggeredPrice === "number" ? a.triggeredPrice : undefined,
    });
  }
  return out.slice(0, MAX_ALERTS);
}

export function parseNotifications(raw: unknown): AppNotification[] {
  if (!Array.isArray(raw)) return [];
  const out: AppNotification[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string" || typeof n.symbol !== "string") continue;
    if (typeof n.title !== "string" || typeof n.body !== "string") continue;
    const action = n.action === "buy" || n.action === "sell" || n.action === "notify" ? n.action : "notify";
    out.push({
      id: n.id,
      alertId: typeof n.alertId === "string" ? n.alertId : "",
      symbol: n.symbol,
      title: n.title,
      body: n.body,
      createdAt: typeof n.createdAt === "number" ? n.createdAt : 0,
      read: n.read === true,
      action,
      complete: n.complete !== false,
    });
  }
  return out.slice(0, MAX_NOTIFICATIONS);
}

export function loadLocalAlerts(): PriceAlert[] {
  try {
    return parsePriceAlerts(JSON.parse(localStorage.getItem("vantage-alerts") ?? "[]"));
  } catch {
    return [];
  }
}

export function loadLocalNotifications(): AppNotification[] {
  try {
    return parseNotifications(JSON.parse(localStorage.getItem("vantage-notifications") ?? "[]"));
  } catch {
    return [];
  }
}

export function directionForTarget(currentPrice: number, targetPrice: number): AlertDirection {
  return targetPrice >= currentPrice ? "above" : "below";
}

export function alertIsTriggered(alert: PriceAlert, price: number): boolean {
  if (!(price > 0) || alert.status !== "pending") return false;
  if (alert.direction === "above") {
    return price >= alert.targetPrice && alert.createdPrice < alert.targetPrice;
  }
  return price <= alert.targetPrice && alert.createdPrice > alert.targetPrice;
}

function applyBuy(holdings: AlertHolding[], symbol: string, shares: number, price: number): AlertHolding[] {
  const existing = holdings.find(h => h.symbol === symbol);
  if (!existing) return [...holdings, { symbol, shares, avgCost: price }];
  const totalShares = existing.shares + shares;
  const avgCost = (existing.avgCost * existing.shares + price * shares) / totalShares;
  return holdings.map(h => (h.symbol === symbol ? { symbol, shares: totalShares, avgCost } : h));
}

function applySell(holdings: AlertHolding[], symbol: string, shares: number): AlertHolding[] {
  return holdings.flatMap(h => {
    if (h.symbol !== symbol) return [h];
    const remaining = h.shares - shares;
    return remaining > 1e-9 ? [{ ...h, shares: remaining }] : [];
  });
}

export function evaluateAlerts(input: {
  alerts: PriceAlert[];
  stocks: Array<{ symbol: string; price: number }>;
  balance: number;
  holdings: AlertHolding[];
  skipIds?: Set<string>;
  now?: number;
}): {
  alerts: PriceAlert[];
  fired: AppNotification[];
  trades: AlertTrade[];
} {
  const now = input.now ?? Date.now();
  const skip = input.skipIds ?? new Set<string>();
  const stockMap = new Map(input.stocks.map(s => [s.symbol, s]));
  let balance = input.balance;
  let holdings = input.holdings;
  const trades: AlertTrade[] = [];
  const fired: AppNotification[] = [];

  const alerts = input.alerts.map(alert => {
    if (alert.status !== "pending" || skip.has(alert.id)) return alert;
    const stock = stockMap.get(alert.symbol);
    if (!stock || !alertIsTriggered(alert, stock.price)) return alert;

    let detail: string;
    if (alert.action === "buy") {
      const shares = alert.shares;
      const cost = shares * stock.price;
      if (shares > 0 && cost <= balance + 1e-9) {
        balance -= cost;
        holdings = applyBuy(holdings, alert.symbol, shares, stock.price);
        trades.push({ type: "buy", symbol: alert.symbol, shares, price: stock.price });
        detail = `Auto-bought ${fmtShares(shares)} ${alert.symbol} at ${fmt$(stock.price)}.`;
      } else {
        detail = `Auto-buy skipped — not enough cash (need ${fmt$(cost)}).`;
      }
    } else if (alert.action === "sell") {
      const held = holdings.find(h => h.symbol === alert.symbol)?.shares ?? 0;
      const shares = Math.min(alert.shares > 0 ? alert.shares : held, held);
      if (shares > 1e-9) {
        const proceeds = shares * stock.price;
        balance += proceeds;
        holdings = applySell(holdings, alert.symbol, shares);
        trades.push({ type: "sell", symbol: alert.symbol, shares, price: stock.price });
        detail = `Auto-sold ${fmtShares(shares)} ${alert.symbol} at ${fmt$(stock.price)}.`;
      } else {
        detail = "Auto-sell skipped — no shares held.";
      }
    } else {
      detail = `Last ${fmt$(stock.price)}.`;
    }

    const dirLabel = alert.direction === "above" ? "hit" : "dropped to";
    fired.push({
      id: `n-${now}-${alert.id}`,
      alertId: alert.id,
      symbol: alert.symbol,
      title: `${alert.symbol} ${dirLabel} ${fmt$(alert.targetPrice)}`,
      body: detail,
      createdAt: now,
      read: false,
      action: alert.action,
      complete: true,
    });

    return {
      ...alert,
      status: "complete" as const,
      triggeredAt: now,
      triggeredPrice: stock.price,
    };
  });

  return { alerts, fired, trades };
}

export function mergeNotifications(
  existing: AppNotification[],
  incoming: AppNotification[],
): AppNotification[] {
  if (!incoming.length) return existing;
  const seen = new Set(existing.map(n => n.id));
  const next = [...incoming.filter(n => !seen.has(n.id)), ...existing];
  return next.slice(0, MAX_NOTIFICATIONS);
}

export function pushBrowserNotification(title: string, body: string) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, silent: false });
  } catch {
    // ignore — browsers can block when the tab is not focused yet
  }
}

export async function requestAlertPermission() {
  if (typeof window === "undefined" || typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // ignore
    }
  }
}

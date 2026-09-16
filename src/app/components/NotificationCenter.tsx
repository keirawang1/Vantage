import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, TrendingDown, TrendingUp, X } from "lucide-react";
import type { AppNotification, PriceAlert } from "../lib/alerts";

const G = "#34d399";

const fmt$ = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function NotificationCenter({
  notifications,
  alerts,
  onMarkRead,
  onMarkAllRead,
  onCancelAlert,
  onOpenSymbol,
}: {
  notifications: AppNotification[];
  alerts: PriceAlert[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onCancelAlert: (id: string) => void;
  onOpenSymbol: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 48, right: 16 });

  const unread = notifications.filter(n => !n.read).length;
  const pending = alerts.filter(a => a.status === "pending");

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="relative w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors flex-shrink-0"
        onClick={() => setOpen(v => !v)}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={15} style={{ color: "var(--v-ink-soft)" }} />
        {unread > 0 && (
          <span
            className="absolute top-1 right-1 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-mono font-semibold flex items-center justify-center"
            style={{ background: G, color: "#0a0a0a" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="fixed z-[120] w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-2xl border shadow-2xl overflow-hidden flex flex-col"
          style={{
            top: pos.top,
            right: pos.right,
            background: "var(--v-panel)",
            borderColor: "var(--v-line-strong)",
            maxHeight: "min(28rem, calc(100vh - 4.5rem))",
          }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "var(--v-line)" }}>
            <div className="font-mono text-[12px] font-semibold tracking-wide" style={{ color: "var(--v-ink)" }}>
              Alerts
            </div>
            {unread > 0 && (
              <button
                type="button"
                className="text-[10px] font-mono hover:opacity-70"
                style={{ color: G }}
                onClick={onMarkAllRead}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
            {pending.length > 0 && (
              <div className="px-4 pt-3 pb-1">
                <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
                  Watching
                </div>
                <div className="flex flex-col gap-1.5">
                  {pending.map(a => (
                    <div
                      key={a.id}
                      className="flex items-start gap-2 rounded-xl px-2.5 py-2"
                      style={{ background: "var(--v-line)" }}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => { onOpenSymbol(a.symbol); setOpen(false); }}
                      >
                        <div className="font-mono text-[12px] font-semibold" style={{ color: "var(--v-ink)" }}>
                          {a.symbol} {a.direction === "above" ? "≥" : "≤"} {fmt$(a.targetPrice)}
                        </div>
                        <div className="text-[10px] mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
                          {a.action === "notify" ? "Alert only" : a.action === "buy" ? `Auto-buy ${a.shares}` : `Auto-sell ${a.shares}`}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-white/10 flex-shrink-0"
                        title="Cancel alert"
                        onClick={() => onCancelAlert(a.id)}
                      >
                        <X size={12} style={{ color: "var(--v-ink-dim)" }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 pt-3 pb-3">
              <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
                Inbox
              </div>
              {notifications.length === 0 ? (
                <div className="py-6 text-center text-[12px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
                  No alerts yet
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {notifications.map(n => (
                    <button
                      key={n.id}
                      type="button"
                      className="w-full text-left rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/5"
                      style={{ background: n.read ? "transparent" : "rgba(52,211,153,0.08)" }}
                      onClick={() => {
                        onMarkRead(n.id);
                        onOpenSymbol(n.symbol);
                        setOpen(false);
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex-shrink-0">
                          {n.action === "sell"
                            ? <TrendingDown size={13} style={{ color: "#f87171" }} />
                            : n.action === "buy"
                              ? <TrendingUp size={13} style={{ color: G }} />
                              : <Bell size={13} style={{ color: G }} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono text-[12px] font-semibold truncate" style={{ color: "var(--v-ink)" }}>
                              {n.title}
                            </span>
                            {n.complete && (
                              <Check size={11} style={{ color: G }} className="flex-shrink-0" />
                            )}
                          </span>
                          <span className="block text-[11px] leading-snug mt-0.5" style={{ color: "var(--v-ink-soft)" }}>
                            {n.body}
                          </span>
                          <span className="block text-[10px] font-mono mt-1" style={{ color: "var(--v-ink-dim)" }}>
                            {fmtWhen(n.createdAt)}
                          </span>
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

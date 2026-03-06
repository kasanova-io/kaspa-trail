// ABOUTME: Transaction list panel showing all fetched transactions.
// ABOUTME: Displays time, direction, counterparties, amounts, and protocol type badges.

"use client";

import { sompiToKas, EXPLORER_BASE_URL, type TxSummary, type PricePoint, interpolatePrice, sompiToKasNum } from "@/lib/api";
import { formatUsd, PROTOCOL_CHIP_STYLES } from "@/lib/format";

interface TxListProps {
  transactions: TxSummary[];
  center: string;
  prices: PricePoint[];
  typeFilter: string;
  onTypeFilterChange: (filter: string) => void;
}

function truncate(addr: string): string {
  const payload = addr.split(":")[1] || addr;
  if (payload.length <= 12) return addr;
  return `${payload.slice(0, 6)}...${payload.slice(-4)}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const TX_TYPE_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  kas: { label: "KAS", bg: "bg-[#3366aa22]", text: "text-[#6699dd]" },
  "krc20:deploy": { label: "KRC20 Deploy", bg: "bg-[#ff9f1a22]", text: "text-[#ff9f1a]" },
  "krc20:mint": { label: "KRC20 Mint", bg: "bg-[#2ff2a822]", text: "text-[#2ff2a8]" },
  "krc20:transfer": { label: "KRC20 Send", bg: "bg-[#ff9f1a22]", text: "text-[#ff9f1a]" },
  "krc20:list": { label: "KRC20 List", bg: "bg-[#cc66ff22]", text: "text-[#cc66ff]" },
  "krc20:send": { label: "KRC20 Swap", bg: "bg-[#cc66ff22]", text: "text-[#cc66ff]" },
  "krc20:unknown": { label: "KRC20", bg: "bg-[#ff9f1a22]", text: "text-[#ff9f1a]" },
  "kns:create": { label: "KNS Create", bg: "bg-[#2ff2a822]", text: "text-[#2ff2a8]" },
  "kns:reveal": { label: "KNS Reveal", bg: "bg-[#2ff2a822]", text: "text-[#2ff2a8]" },
  "krc721:transfer": { label: "KRC721 Transfer", bg: "bg-[#e6557022]", text: "text-[#e65570]" },
  "krc721:mint": { label: "KRC721 Mint", bg: "bg-[#e6557022]", text: "text-[#e65570]" },
  "kasia:message": { label: "Kasia Message", bg: "bg-[#55bbff22]", text: "text-[#55bbff]" },
  "p2sh:commit": { label: "P2SH Commit", bg: "bg-[#8888a022]", text: "text-[#5a7090]" },
  "p2sh:reveal": { label: "P2SH Reveal", bg: "bg-[#8888a022]", text: "text-[#5a7090]" },
};

function getTxTypeStyle(txType: string): { label: string; bg: string; text: string } {
  // Try exact match first
  if (TX_TYPE_STYLES[txType]) return TX_TYPE_STYLES[txType];
  // Try prefix match for "krc20:transfer:NACHO" -> "krc20:transfer"
  const parts = txType.split(":");
  if (parts.length >= 2) {
    const prefix = `${parts[0]}:${parts[1]}`;
    if (TX_TYPE_STYLES[prefix]) {
      const style = TX_TYPE_STYLES[prefix];
      // Include ticker if present
      const tick = parts[2];
      return tick ? { ...style, label: `${style.label} ${tick}` } : style;
    }
  }
  return { label: txType, bg: "bg-[#55668822]", text: "text-[#556688]" };
}

// Protocol family order for consistent display
const PROTOCOL_ORDER = ["kas", "krc20", "kns", "krc721", "kasia", "p2sh"];

function getProtocolFamily(txType: string): string {
  const prefix = txType.split(":")[0];
  if (PROTOCOL_ORDER.includes(prefix)) return prefix;
  return txType;
}

function getUniqueProtocols(transactions: TxSummary[]): string[] {
  const protocols = new Set<string>();
  for (const tx of transactions) {
    protocols.add(getProtocolFamily(tx.tx_type));
  }
  return PROTOCOL_ORDER.filter((p) => protocols.has(p));
}

export default function TxList({ transactions, center, prices, typeFilter, onTypeFilterChange }: TxListProps) {
  if (transactions.length === 0) {
    return (
      <div className="p-4 text-xs text-[var(--color-text-dim)] mono tracking-wide text-center py-8">
        No transactions loaded
      </div>
    );
  }

  const uniqueProtocols = getUniqueProtocols(transactions);

  const filtered = typeFilter === "all"
    ? transactions
    : transactions.filter((tx) => getProtocolFamily(tx.tx_type) === typeFilter);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--color-border)] space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="section-label">
            Transactions
          </h3>
          <span className="text-[10px] text-[var(--color-text-dim)] mono">
            {filtered.length}{typeFilter !== "all" ? `/${transactions.length}` : ""} loaded
          </span>
        </div>
        {/* Protocol filter chips */}
        {uniqueProtocols.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => onTypeFilterChange("all")}
              className={`toolbar-btn ${
                typeFilter === "all"
                  ? "toolbar-btn-active"
                  : "toolbar-btn-inactive"
              }`}
            >
              All
            </button>
            {uniqueProtocols.map((protocol) => {
              const style = PROTOCOL_CHIP_STYLES[protocol] || { label: protocol, bg: "bg-[#55668822]", text: "text-[#556688]" };
              return (
                <button
                  key={protocol}
                  onClick={() => onTypeFilterChange(protocol)}
                  className={`toolbar-btn ${
                    typeFilter === protocol
                      ? "toolbar-btn-active"
                      : `${style.bg} ${style.text} hover:opacity-80 border border-transparent`
                  }`}
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {filtered.map((tx) => {
          const isIncoming = tx.outputs.includes(center) && !tx.inputs.includes(center);
          const isOutgoing = tx.inputs.includes(center) && !tx.outputs.includes(center);
          const isSelf = tx.inputs.includes(center) && tx.outputs.includes(center);

          const dirClass = isIncoming
            ? "dir-in"
            : isOutgoing
            ? "dir-out"
            : isSelf
            ? "dir-self"
            : "text-[#5a7090]";
          const dirLabel = isIncoming ? "IN" : isOutgoing ? "OUT" : isSelf ? "SELF" : "---";

          const totalAmount = tx.amounts.reduce((a, b) => a + b, 0);

          const counterparties = isIncoming
            ? tx.inputs.filter((a) => a !== center)
            : tx.outputs.filter((a) => a !== center);

          const typeStyle = getTxTypeStyle(tx.tx_type);

          const priceAtTime = prices.length > 0 ? interpolatePrice(prices, tx.block_time) : null;
          const usdValue = priceAtTime ? sompiToKasNum(totalAmount) * priceAtTime : null;

          return (
            <div
              key={tx.tx_id}
              className="tx-row px-4 py-3"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold tracking-wider ${dirClass}`}>
                    {dirLabel}
                  </span>
                  {tx.tx_type !== "kas" && (
                    <span className={`protocol-badge ${typeStyle.bg} ${typeStyle.text} border border-transparent`}>
                      {typeStyle.label}
                    </span>
                  )}
                  <a
                    href={`${EXPLORER_BASE_URL}/transaction/${tx.tx_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] mono text-[var(--color-node)] hover:text-[var(--color-accent)] transition-colors"
                  >
                    {tx.tx_id.slice(0, 12)}...
                  </a>
                </div>
                <span className="text-[10px] text-[var(--color-text-dim)] mono">
                  {formatTime(tx.block_time)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-[10px] text-[var(--color-text-muted)] space-y-0.5">
                  {counterparties.length > 0 ? (
                    counterparties.slice(0, 3).map((addr) => (
                      <span key={addr} className="block mono">
                        {truncate(addr)}
                      </span>
                    ))
                  ) : (
                    <span className="mono">{truncate(center)}</span>
                  )}
                  {counterparties.length > 3 && (
                    <span className="text-[var(--color-text-dim)]">
                      +{counterparties.length - 3} more
                    </span>
                  )}
                </div>
                <div className="text-right ml-2">
                  <span className="text-xs font-semibold whitespace-nowrap block">
                    {sompiToKas(totalAmount)} KAS
                  </span>
                  {usdValue !== null && (
                    <span className="text-[9px] text-[var(--color-text-dim)] whitespace-nowrap mono">
                      {formatUsd(usdValue)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ABOUTME: Side panel showing details about a selected node or edge.
// ABOUTME: Displays address info, balance, timestamps, domains, tokens, patterns, labels, and USD values.

"use client";

import { useEffect, useState } from "react";
import {
  sompiToKas,
  sompiToKasNum,
  fetchAddressDetails,
  interpolatePrice,
  EXPLORER_BASE_URL,
  type GraphNode,
  type GraphEdge,
  type AddressDetails,
  type PricePoint,
} from "@/lib/api";
import { getLabel, setLabel } from "@/lib/caseStore";

interface InfoPanelProps {
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  onExpandNode: (address: string) => void;
  prices: PricePoint[];
  onLabelChange: () => void;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatAge(firstMs: number): string {
  const diff = Date.now() - firstMs;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days < 1) return "< 1 day";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  const years = Math.floor(days / 365);
  const remainingMonths = Math.floor((days % 365) / 30);
  return remainingMonths > 0 ? `${years}y ${remainingMonths}mo` : `${years}y`;
}

function formatTokenBalance(balance: string, decimals: number): string {
  if (decimals === 0) return balance;
  const padded = balance.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, -decimals) || "0";
  const fracPart = padded.slice(-decimals).replace(/0+$/, "");
  const num = parseFloat(`${intPart}.${fracPart || "0"}`);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(Math.min(2, decimals));
}

function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

const PATTERN_LABELS: Record<string, { label: string; color: string }> = {
  peel_chain: { label: "⛓ Peel Chain", color: "text-[#ff9f1a]" },
  fan_out: { label: "⤴ Fan-out", color: "text-[#ff4466]" },
  fan_in: { label: "⤵ Fan-in", color: "text-[#2ff2a8]" },
  dust: { label: "• Dust", color: "text-[#8888a0]" },
};

export default function InfoPanel({
  selectedNode,
  selectedEdge,
  onExpandNode,
  prices,
  onLabelChange,
}: InfoPanelProps) {
  const [details, setDetails] = useState<AddressDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  useEffect(() => {
    if (!selectedNode) { setDetails(null); return; }
    let cancelled = false;
    setDetailsLoading(true);
    setLabelInput(getLabel(selectedNode.id));
    fetchAddressDetails(selectedNode.id)
      .then((d) => { if (!cancelled) setDetails(d); })
      .catch(() => { if (!cancelled) setDetails(null); })
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedNode]);

  if (!selectedNode && !selectedEdge) {
    return (
      <div className="p-4 text-sm text-[var(--color-text-muted)]">
        Click a node or edge to inspect
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="p-4 space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-[var(--color-accent)] uppercase tracking-wider">Address</h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
            selectedNode.addr_type === "p2sh" ? "bg-[#cc66ff22] text-[#cc66ff]" : "bg-[#3366aa22] text-[#6699dd]"
          }`}>
            {selectedNode.addr_type === "p2sh" ? "P2SH" : "P2PK"}
          </span>
        </div>
        {selectedNode.name && <p className="text-sm font-bold text-[#ff9f1a]">{selectedNode.name}</p>}
        <p className="break-all font-mono text-[10px]">{selectedNode.id}</p>

        {/* Patterns */}
        {selectedNode.patterns.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {selectedNode.patterns.map((p) => {
              const info = PATTERN_LABELS[p];
              return info ? (
                <span key={p} className={`text-[9px] px-1.5 py-0.5 rounded bg-[#ffffff08] font-bold ${info.color}`}>
                  {info.label}
                </span>
              ) : null;
            })}
          </div>
        )}

        {details?.primary_domain && (
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--color-text-muted)]">Primary:</span>
            <span className="font-bold text-[#2ff2a8]">{details.primary_domain}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded bg-[var(--color-bg)]">
            <span className="text-[var(--color-text-muted)]">Balance</span>
            <p className="font-bold">
              {details ? `${sompiToKas(details.balance)} KAS` : selectedNode.balance !== null ? `${sompiToKas(selectedNode.balance)} KAS` : detailsLoading ? "..." : "—"}
            </p>
            {details && prices.length > 0 && (() => {
              const p = prices[prices.length - 1]?.price_usd;
              return p ? <p className="text-[9px] text-[var(--color-text-muted)]">{formatUsd(sompiToKasNum(details.balance) * p)}</p> : null;
            })()}
          </div>
          <div className="p-2 rounded bg-[var(--color-bg)]">
            <span className="text-[var(--color-text-muted)]">Transactions</span>
            <p className="font-bold">{details ? details.tx_count.toLocaleString() : selectedNode.tx_count}</p>
          </div>
          {details?.first_tx_time && (
            <div className="p-2 rounded bg-[var(--color-bg)]">
              <span className="text-[var(--color-text-muted)]">Age</span>
              <p className="font-bold">{formatAge(details.first_tx_time)}</p>
            </div>
          )}
          {details?.first_tx_time && (
            <div className="p-2 rounded bg-[var(--color-bg)]">
              <span className="text-[var(--color-text-muted)]">First Tx</span>
              <p className="font-bold text-[10px]">{formatTimestamp(details.first_tx_time)}</p>
            </div>
          )}
          {details?.last_tx_time && (
            <div className="col-span-2 p-2 rounded bg-[var(--color-bg)]">
              <span className="text-[var(--color-text-muted)]">Last Tx</span>
              <p className="font-bold text-[10px]">{formatTimestamp(details.last_tx_time)}</p>
            </div>
          )}
        </div>

        {details && details.domains.length > 0 && (
          <div className="space-y-1">
            <p className="text-[var(--color-text-muted)] font-bold uppercase tracking-wider">Domains ({details.domains.length})</p>
            <div className="max-h-24 overflow-auto space-y-0.5">
              {details.domains.map((d) => (
                <div key={d.name} className="flex items-center justify-between px-1">
                  <span className="font-mono text-[#ff9f1a]">{d.name}</span>
                  {d.status === "listed" && <span className="text-[9px] px-1 py-0.5 rounded bg-[#2ff2a822] text-[#2ff2a8]">listed</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {details && details.tokens.length > 0 && (
          <div className="space-y-1">
            <p className="text-[var(--color-text-muted)] font-bold uppercase tracking-wider">Tokens ({details.tokens.length})</p>
            <div className="max-h-32 overflow-auto space-y-0.5">
              {details.tokens.map((t) => (
                <div key={t.tick} className="flex items-center justify-between px-1">
                  <span className="font-bold">{t.tick}</span>
                  <span className="font-mono text-[var(--color-text-muted)]">{formatTokenBalance(t.balance, t.decimals)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom label */}
        <div className="space-y-1">
          <p className="text-[var(--color-text-muted)] font-bold uppercase tracking-wider">Label</p>
          <div className="flex gap-1">
            <input
              type="text" value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Add custom label..."
              className="flex-1 px-2 py-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-[10px] focus:outline-none focus:border-[var(--color-accent)]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setLabel(selectedNode.id, labelInput);
                  onLabelChange();
                }
              }}
            />
            <button onClick={() => { setLabel(selectedNode.id, labelInput); onLabelChange(); }}
              className="px-2 py-1 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-[10px] font-bold cursor-pointer hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]">
              Set
            </button>
          </div>
        </div>

        {detailsLoading && <p className="text-[10px] text-[var(--color-text-muted)] text-center animate-pulse">Loading details...</p>}

        {!selectedNode.is_center && (
          <div className="mt-2">
            <button onClick={() => onExpandNode(selectedNode.id)}
              className="w-full px-3 py-2 rounded text-xs font-bold bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] transition-colors cursor-pointer">
              Expand this address
            </button>
            <p className="text-[9px] text-[var(--color-text-muted)] text-center mt-1">
              Load this address&apos;s connections into the graph
            </p>
          </div>
        )}

        <a href={`${EXPLORER_BASE_URL}/address/${selectedNode.id}`} target="_blank" rel="noopener noreferrer"
          className="block text-center text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors">
          View on Explorer
        </a>
      </div>
    );
  }

  if (selectedEdge) {
    const edgeTime = selectedEdge.first_seen || selectedEdge.last_seen;
    const priceAtTime = edgeTime ? interpolatePrice(prices, edgeTime) : null;
    const usdValue = priceAtTime ? sompiToKasNum(selectedEdge.total_amount) * priceAtTime : null;

    return (
      <div className="p-4 space-y-3 text-xs">
        <h3 className="font-bold text-[var(--color-accent)] uppercase tracking-wider">Flow</h3>
        <div className="space-y-1">
          <p className="text-[var(--color-text-muted)]">From</p>
          <p className="break-all font-mono text-[10px]">{selectedEdge.source}</p>
          <p className="text-[var(--color-text-muted)] mt-2">To</p>
          <p className="break-all font-mono text-[10px]">{selectedEdge.target}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded bg-[var(--color-bg)]">
            <span className="text-[var(--color-text-muted)]">Total</span>
            <p className="font-bold">{sompiToKas(selectedEdge.total_amount)} KAS</p>
            {usdValue !== null && <p className="text-[9px] text-[var(--color-text-muted)]">{formatUsd(usdValue)}</p>}
          </div>
          <div className="p-2 rounded bg-[var(--color-bg)]">
            <span className="text-[var(--color-text-muted)]">Transactions</span>
            <p className="font-bold">{selectedEdge.tx_count}</p>
          </div>
        </div>
        {selectedEdge.first_seen > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded bg-[var(--color-bg)]">
              <span className="text-[var(--color-text-muted)]">First</span>
              <p className="font-bold text-[10px]">{formatTimestamp(selectedEdge.first_seen)}</p>
            </div>
            <div className="p-2 rounded bg-[var(--color-bg)]">
              <span className="text-[var(--color-text-muted)]">Last</span>
              <p className="font-bold text-[10px]">{formatTimestamp(selectedEdge.last_seen)}</p>
            </div>
          </div>
        )}
        {selectedEdge.is_change && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ffffff08] text-[#8888a0] font-bold">Change output</span>
        )}
        {selectedEdge.tx_types && Object.keys(selectedEdge.tx_types).length > 0 && (
          <div className="space-y-1">
            <p className="text-[var(--color-text-muted)]">Types</p>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(selectedEdge.tx_types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <span key={type} className="text-[9px] px-1.5 py-0.5 rounded bg-[#ffffff08] font-bold text-[var(--color-text-muted)]">
                  {type} ({count})
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1 max-h-32 overflow-auto">
          <p className="text-[var(--color-text-muted)]">TX IDs</p>
          {selectedEdge.tx_ids.map((txId) => (
            <a key={txId} href={`${EXPLORER_BASE_URL}/transaction/${txId}`} target="_blank" rel="noopener noreferrer"
              className="block font-mono truncate text-[var(--color-node)] hover:text-[var(--color-accent)] transition-colors text-[10px]">
              {txId.slice(0, 16)}...
            </a>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

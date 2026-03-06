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
import { formatUsd } from "@/lib/format";
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

const PATTERN_LABELS: Record<string, { label: string; color: string }> = {
  peel_chain: { label: "Peel Chain", color: "text-[#ff9f1a]" },
  fan_out: { label: "Fan-out", color: "text-[#ff3a5c]" },
  fan_in: { label: "Fan-in", color: "text-[#2ff2a8]" },
  dust: { label: "Dust", color: "text-[#5a7090]" },
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
      <div className="p-4 text-xs text-[var(--color-text-dim)] flex flex-col items-center justify-center h-32 gap-2">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1.5" opacity="0.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <span className="mono text-[10px] tracking-wide">Click a node or edge to inspect</span>
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="p-4 space-y-3 text-xs">
        <div className="flex items-center gap-2">
          <h3 className="section-label">Address</h3>
          <span className={`protocol-badge ${
            selectedNode.addr_type === "p2sh" ? "bg-[#cc66ff15] text-[#cc66ff] border border-[#cc66ff30]" : "bg-[#3366aa15] text-[#6699dd] border border-[#3366aa30]"
          }`}>
            {selectedNode.addr_type === "p2sh" ? "P2SH" : "P2PK"}
          </span>
        </div>
        {selectedNode.name && <p className="entity-name">{selectedNode.name}</p>}
        <p className="addr-hash">{selectedNode.id}</p>

        {/* Patterns */}
        {selectedNode.patterns.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {selectedNode.patterns.map((p) => {
              const info = PATTERN_LABELS[p];
              return info ? (
                <span key={p} className={`protocol-badge bg-[#ffffff06] border border-[#ffffff10] ${info.color}`}>
                  {info.label}
                </span>
              ) : null;
            })}
          </div>
        )}

        {details?.primary_domain && (
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--color-text-muted)]">Primary:</span>
            <span className="primary-domain">{details.primary_domain}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div className="info-card info-card-accent">
            <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Balance</span>
            <p className="font-semibold mt-0.5">
              {details ? `${sompiToKas(details.balance)} KAS` : selectedNode.balance !== null ? `${sompiToKas(selectedNode.balance)} KAS` : detailsLoading ? "..." : "\u2014"}
            </p>
            {details && prices.length > 0 && (() => {
              const p = prices[prices.length - 1]?.price_usd;
              return p ? <p className="text-[9px] text-[var(--color-text-dim)] mono">{formatUsd(sompiToKasNum(details.balance) * p)}</p> : null;
            })()}
          </div>
          <div className="info-card">
            <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Transactions</span>
            <p className="font-semibold mt-0.5 mono">{details ? details.tx_count.toLocaleString() : selectedNode.tx_count}</p>
          </div>
          {details?.first_tx_time && (
            <div className="info-card">
              <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Age</span>
              <p className="font-semibold mt-0.5">{formatAge(details.first_tx_time)}</p>
            </div>
          )}
          {details?.first_tx_time && (
            <div className="info-card">
              <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">First Tx</span>
              <p className="font-semibold text-[10px] mt-0.5 mono">{formatTimestamp(details.first_tx_time)}</p>
            </div>
          )}
          {details?.last_tx_time && (
            <div className="col-span-2 info-card">
              <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Last Tx</span>
              <p className="font-semibold text-[10px] mt-0.5 mono">{formatTimestamp(details.last_tx_time)}</p>
            </div>
          )}
        </div>

        {details && details.domains.length > 0 && (
          <div className="space-y-1.5">
            <p className="section-label">Domains ({details.domains.length})</p>
            <div className="max-h-24 overflow-auto space-y-0.5">
              {details.domains.map((d) => (
                <div key={d.name} className="domain-row">
                  <span className="mono text-[#ff9f1a]">{d.name}</span>
                  {d.status === "listed" && <span className="listed-badge">listed</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {details && details.tokens.length > 0 && (
          <div className="space-y-1.5">
            <p className="section-label">Tokens ({details.tokens.length})</p>
            <div className="max-h-32 overflow-auto space-y-0.5">
              {details.tokens.map((t) => (
                <div key={t.tick} className="token-row">
                  <span className="font-semibold">{t.tick}</span>
                  <span className="mono text-[var(--color-text-muted)]">{formatTokenBalance(t.balance, t.decimals)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom label */}
        <div className="space-y-1.5">
          <p className="section-label">Label</p>
          <div className="flex gap-1">
            <input
              type="text" value={labelInput} onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Add custom label..."
              className="flex-1 px-2 py-1.5 rounded field-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setLabel(selectedNode.id, labelInput);
                  onLabelChange();
                }
              }}
            />
            <button onClick={() => { setLabel(selectedNode.id, labelInput); onLabelChange(); }}
              className="px-2.5 py-1.5 rounded text-[10px] btn-primary">
              Set
            </button>
          </div>
        </div>

        {detailsLoading && <p className="text-[10px] text-[var(--color-text-dim)] text-center animate-pulse mono tracking-wide">Loading details...</p>}

        {!selectedNode.is_center && (
          <div className="mt-2">
            <button onClick={() => onExpandNode(selectedNode.id)}
              className="w-full px-3 py-2.5 rounded text-xs btn-primary">
              Expand this address
            </button>
            <p className="text-[9px] text-[var(--color-text-dim)] text-center mt-1 mono">
              Load this address&apos;s connections into the graph
            </p>
          </div>
        )}

        <a href={`${EXPLORER_BASE_URL}/address/${selectedNode.id}`} target="_blank" rel="noopener noreferrer"
          className="explorer-link">
          View on Explorer &rarr;
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
        <h3 className="section-label">Flow</h3>
        <div className="space-y-1">
          <p className="text-[var(--color-text-dim)] text-[9px] uppercase tracking-wider">From</p>
          <p className="addr-hash">{selectedEdge.source}</p>
          <p className="text-[var(--color-text-dim)] text-[9px] uppercase tracking-wider mt-2">To</p>
          <p className="addr-hash">{selectedEdge.target}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="info-card info-card-accent">
            <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Total</span>
            <p className="font-semibold mt-0.5">{sompiToKas(selectedEdge.total_amount)} KAS</p>
            {usdValue !== null && <p className="text-[9px] text-[var(--color-text-dim)] mono">{formatUsd(usdValue)}</p>}
          </div>
          <div className="info-card">
            <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Transactions</span>
            <p className="font-semibold mt-0.5 mono">{selectedEdge.tx_count}</p>
          </div>
        </div>
        {selectedEdge.first_seen > 0 && (
          <div className="grid grid-cols-2 gap-2">
            <div className="info-card">
              <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">First</span>
              <p className="font-semibold text-[10px] mt-0.5 mono">{formatTimestamp(selectedEdge.first_seen)}</p>
            </div>
            <div className="info-card">
              <span className="text-[var(--color-text-muted)] text-[9px] uppercase tracking-wider">Last</span>
              <p className="font-semibold text-[10px] mt-0.5 mono">{formatTimestamp(selectedEdge.last_seen)}</p>
            </div>
          </div>
        )}
        {selectedEdge.is_change && (
          <span className="protocol-badge bg-[#ffffff06] text-[#5a7090] border border-[#ffffff10]">Change output</span>
        )}
        {selectedEdge.tx_types && Object.keys(selectedEdge.tx_types).length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[var(--color-text-dim)] text-[9px] uppercase tracking-wider">Types</p>
            <div className="flex gap-1 flex-wrap">
              {Object.entries(selectedEdge.tx_types).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                <span key={type} className="protocol-badge bg-[#ffffff06] text-[var(--color-text-muted)] border border-[#ffffff10]">
                  {type} ({count})
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-1.5 max-h-32 overflow-auto">
          <p className="text-[var(--color-text-dim)] text-[9px] uppercase tracking-wider">TX IDs</p>
          {selectedEdge.tx_ids.map((txId) => (
            <a key={txId} href={`${EXPLORER_BASE_URL}/transaction/${txId}`} target="_blank" rel="noopener noreferrer"
              className="explorer-link !text-left truncate">
              {txId.slice(0, 16)}...
            </a>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

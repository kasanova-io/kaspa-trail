// ABOUTME: Toolbar for graph controls — export, layout, search, animation, path finding, taint.
// ABOUTME: Sits above the graph and provides all analytical tools.

"use client";

import { useState, useCallback } from "react";

export type LayoutType = "force" | "radial";
export type ToolMode = "select" | "path" | "taint";

interface GraphControlsProps {
  onExportSVG: () => void;
  onExportPNG: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  toolMode: ToolMode;
  onToolModeChange: (mode: ToolMode) => void;
  // Animation
  isPlaying: boolean;
  onTogglePlay: () => void;
  animationProgress: number;
  onProgressChange: (pct: number) => void;
  hasTimeData: boolean;
  // Progressive loading
  txLoaded: number;
  txTotal: number;
  onLoadMore: () => void;
  loadingMore: boolean;
  // Protocol filter
  protocolFilter: string;
  onProtocolFilterChange: (filter: string) => void;
  availableProtocols: string[];
}

const PROTOCOL_ORDER = ["kas", "krc20", "kns", "krc721", "kasia", "p2sh"];
const PROTOCOL_CHIP_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  kas: { label: "KAS", bg: "bg-[#3366aa22]", text: "text-[#6699dd]" },
  krc20: { label: "KRC20", bg: "bg-[#ff9f1a22]", text: "text-[#ff9f1a]" },
  kns: { label: "KNS", bg: "bg-[#2ff2a822]", text: "text-[#2ff2a8]" },
  krc721: { label: "KRC721", bg: "bg-[#e6557022]", text: "text-[#e65570]" },
  kasia: { label: "Kasia", bg: "bg-[#55bbff22]", text: "text-[#55bbff]" },
  p2sh: { label: "P2SH", bg: "bg-[#8888a022]", text: "text-[#8888a0]" },
};

export default function GraphControls({
  onExportSVG,
  onExportPNG,
  onExportJSON,
  onExportCSV,
  layout,
  onLayoutChange,
  searchQuery,
  onSearchChange,
  toolMode,
  onToolModeChange,
  isPlaying,
  onTogglePlay,
  animationProgress,
  onProgressChange,
  hasTimeData,
  txLoaded,
  txTotal,
  onLoadMore,
  loadingMore,
  protocolFilter,
  onProtocolFilterChange,
  availableProtocols,
}: GraphControlsProps) {
  const [showExport, setShowExport] = useState(false);

  const btnCls = useCallback(
    (active: boolean) =>
      `px-2 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
        active
          ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
          : "bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      }`,
    []
  );

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[10px] flex-wrap">
      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search graph..."
        className="w-32 px-2 py-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] placeholder-[var(--color-text-muted)] text-[10px] focus:outline-none focus:border-[var(--color-accent)]"
      />

      <div className="w-px h-4 bg-[var(--color-border)]" />

      {/* Tool modes */}
      <button className={btnCls(toolMode === "select")} onClick={() => onToolModeChange("select")}>
        Select
      </button>
      <button className={btnCls(toolMode === "path")} onClick={() => onToolModeChange("path")} title="Click two nodes to find shortest path">
        Path
      </button>
      <button className={btnCls(toolMode === "taint")} onClick={() => onToolModeChange("taint")} title="Click a node to trace forward taint">
        Taint
      </button>

      <div className="w-px h-4 bg-[var(--color-border)]" />

      {/* Layout */}
      <button className={btnCls(layout === "force")} onClick={() => onLayoutChange("force")}>
        Force
      </button>
      <button className={btnCls(layout === "radial")} onClick={() => onLayoutChange("radial")}>
        Radial
      </button>

      {/* Protocol filter */}
      {availableProtocols.length > 1 && (
        <>
          <div className="w-px h-4 bg-[var(--color-border)]" />
          <button
            className={btnCls(protocolFilter === "all")}
            onClick={() => onProtocolFilterChange("all")}
          >
            All
          </button>
          {availableProtocols.map((p) => {
            const style = PROTOCOL_CHIP_STYLES[p] || { label: p, bg: "bg-[#55668822]", text: "text-[#556688]" };
            return (
              <button
                key={p}
                onClick={() => onProtocolFilterChange(p)}
                className={`px-2 py-1 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                  protocolFilter === p
                    ? "bg-[var(--color-accent)] text-[var(--color-bg)]"
                    : `${style.bg} ${style.text} hover:opacity-80`
                }`}
              >
                {style.label}
              </button>
            );
          })}
        </>
      )}

      <div className="w-px h-4 bg-[var(--color-border)]" />

      {/* Time animation */}
      {hasTimeData && (
        <>
          <button
            onClick={onTogglePlay}
            className="px-2 py-1 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] cursor-pointer font-bold"
          >
            {isPlaying ? "||" : "\u25B6"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={animationProgress}
            onChange={(e) => onProgressChange(Number(e.target.value))}
            className="w-20 h-1 accent-[var(--color-accent)]"
          />
        </>
      )}

      <div className="flex-1" />

      {/* Progressive loading */}
      {txLoaded < txTotal && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className="px-2 py-1 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] cursor-pointer font-bold disabled:opacity-50"
        >
          {loadingMore ? "..." : `Load more (${txLoaded}/${txTotal})`}
        </button>
      )}

      {/* Export */}
      <div className="relative">
        <button
          onClick={() => setShowExport(!showExport)}
          className="px-2 py-1 rounded bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer font-bold"
        >
          Export
        </button>
        {showExport && (
          <div className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg z-50 py-1 min-w-[100px]">
            {[
              { label: "SVG", fn: onExportSVG },
              { label: "PNG", fn: onExportPNG },
              { label: "JSON", fn: onExportJSON },
              { label: "CSV", fn: onExportCSV },
            ].map(({ label, fn }) => (
              <button
                key={label}
                onClick={() => { fn(); setShowExport(false); }}
                className="block w-full text-left px-3 py-1.5 text-[10px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

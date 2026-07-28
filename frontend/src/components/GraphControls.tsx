// ABOUTME: Toolbar for graph controls — export, layout, search, animation, path finding, taint.
// ABOUTME: Sits above the graph and provides all analytical tools.

"use client";

import { useState, useCallback } from "react";
import { PROTOCOL_CHIP_STYLES } from "@/lib/format";

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
  // Token sub-filter (KRC20 tickers)
  tokenFilter: string;
  onTokenFilterChange: (filter: string) => void;
  availableTokens: string[];
}

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
  tokenFilter,
  onTokenFilterChange,
  availableTokens,
}: GraphControlsProps) {
  const [showExport, setShowExport] = useState(false);

  const btnCls = useCallback(
    (active: boolean) =>
      `toolbar-btn ${active ? "toolbar-btn-active" : "toolbar-btn-inactive"}`,
    []
  );

  return (
    <div className="toolbar flex items-center gap-2 px-3 py-1.5 text-[10px] flex-nowrap md:flex-wrap">
      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search graph..."
        className="w-32 px-2 py-1 rounded field-input"
      />

      <div className="divider-v" />

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

      <div className="divider-v" />

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
          <div className="divider-v" />
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
                className={`toolbar-btn ${
                  protocolFilter === p
                    ? "toolbar-btn-active"
                    : `${style.bg} ${style.text} hover:opacity-80 border border-transparent`
                }`}
              >
                {style.label}
              </button>
            );
          })}
          {/* Token sub-filter when KRC20 is selected */}
          {protocolFilter === "krc20" && availableTokens.length > 0 && (
            <>
              <span className="text-[var(--color-text-dim)] px-1">/</span>
              <select
                value={tokenFilter}
                onChange={(e) => onTokenFilterChange(e.target.value)}
                className="toolbar-btn field-input px-2 py-1 text-[10px] bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)] rounded cursor-pointer"
              >
                <option value="all">All tokens</option>
                {availableTokens.map((tick) => (
                  <option key={tick} value={tick}>{tick}</option>
                ))}
              </select>
            </>
          )}
        </>
      )}

      <div className="divider-v" />

      {/* Time animation */}
      {hasTimeData && (
        <>
          <button
            onClick={onTogglePlay}
            className="toolbar-btn toolbar-btn-inactive hover:text-[var(--color-accent)]"
          >
            {isPlaying ? "||" : "\u25B6"}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={animationProgress}
            onChange={(e) => onProgressChange(Number(e.target.value))}
            className="w-20"
          />
        </>
      )}

      <div className="flex-1" />

      {/* Progressive loading */}
      {txLoaded < txTotal && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className="toolbar-btn btn-primary disabled:opacity-50"
        >
          {loadingMore ? "..." : `Load more (${txLoaded}/${txTotal})`}
        </button>
      )}

      {/* Export */}
      <div className="relative">
        <button
          onClick={() => setShowExport(!showExport)}
          className="toolbar-btn toolbar-btn-inactive"
        >
          Export
        </button>
        {showExport && (
          <div className="absolute right-0 top-full mt-1 export-dropdown z-50 py-1 min-w-[100px]">
            {[
              { label: "SVG", fn: onExportSVG },
              { label: "PNG", fn: onExportPNG },
              { label: "JSON", fn: onExportJSON },
              { label: "CSV", fn: onExportCSV },
            ].map(({ label, fn }) => (
              <button
                key={label}
                onClick={() => { fn(); setShowExport(false); }}
                className="export-item block w-full text-left px-3 py-1.5 text-[10px] text-[var(--color-text-muted)]"
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

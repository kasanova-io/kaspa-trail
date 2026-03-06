// ABOUTME: Main page for Kaspa forensics — address search and graph visualization.
// ABOUTME: Wires graph controls, tool modes, animation, export, cases, labels, and price data.

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import AddressSearch from "@/components/AddressSearch";
import GraphView, { type GraphViewHandle } from "@/components/GraphView";
import GraphControls, { type LayoutType, type ToolMode } from "@/components/GraphControls";
import InfoPanel from "@/components/InfoPanel";
import TxList from "@/components/TxList";
import {
  fetchAddressGraph,
  fetchPriceRange,
  resolveDomain,
  isKnsDomain,
  sompiToKas,
  type AddressGraph,
  type GraphNode,
  type GraphEdge,
  type PricePoint,
} from "@/lib/api";
import {
  findShortestPath,
  computeForwardTaint,
  getTimeRange,
} from "@/lib/graphAnalysis";
import { getLabels, listCases, createCase, saveCase, deleteCase, type SavedCase } from "@/lib/caseStore";

function getInputFromHash(): string {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash.slice(1);
  if (hash.startsWith("kaspa:")) return hash;
  if (isKnsDomain(hash)) return hash;
  return "";
}

export default function Home() {
  const graphRef = useRef<GraphViewHandle>(null);

  const [graph, setGraph] = useState<AddressGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [rightTab, setRightTab] = useState<"inspect" | "txs" | "cases">("inspect");
  const [currentAddress, setCurrentAddress] = useState("");

  // Controls state
  const [layout, setLayout] = useState<LayoutType>("force");
  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [searchQuery, setSearchQuery] = useState("");
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});

  // Animation state
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(100);
  const animationRef = useRef<number | null>(null);
  const timeRangeRef = useRef<[number, number] | null>(null);

  // Progressive loading
  const [loadingMore, setLoadingMore] = useState(false);

  // Tx type filter
  const [txTypeFilter, setTxTypeFilter] = useState("all");

  // Path-finding state
  const [pathSource, setPathSource] = useState<string | null>(null);

  // Cases
  const [cases, setCases] = useState<SavedCase[]>([]);
  const [caseName, setCaseName] = useState("");

  // Load labels from localStorage
  useEffect(() => {
    setLabels(getLabels());
  }, []);

  const refreshLabels = useCallback(() => {
    setLabels(getLabels());
  }, []);

  // Load cases
  useEffect(() => {
    setCases(listCases());
  }, []);

  // Fetch prices when graph loads
  useEffect(() => {
    if (!graph) { setPrices([]); return; }
    const range = getTimeRange(graph.edges);
    timeRangeRef.current = range;
    if (!range) return;
    fetchPriceRange(range[0], range[1])
      .then(setPrices)
      .catch(() => setPrices([]));
  }, [graph]);

  // Search highlighting
  useEffect(() => {
    if (!graphRef.current) return;
    if (searchQuery.length > 2) {
      graphRef.current.highlightSearch(searchQuery);
    } else if (searchQuery.length === 0) {
      graphRef.current.clearHighlights();
    }
  }, [searchQuery]);

  // Animation playback
  useEffect(() => {
    if (!isPlaying || !timeRangeRef.current || !graphRef.current) return;
    let progress = animationProgress;
    const step = () => {
      progress += 0.3;
      if (progress >= 100) {
        progress = 100;
        setIsPlaying(false);
      }
      setAnimationProgress(progress);
      const range = timeRangeRef.current!;
      const cutoff = range[0] + (range[1] - range[0]) * (progress / 100);
      graphRef.current?.applyTimeFilter([range[0], cutoff]);
      if (progress < 100) {
        animationRef.current = requestAnimationFrame(step);
      }
    };
    animationRef.current = requestAnimationFrame(step);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProgressChange = useCallback((pct: number) => {
    setAnimationProgress(pct);
    setIsPlaying(false);
    if (!timeRangeRef.current || !graphRef.current) return;
    if (pct >= 100) {
      graphRef.current.applyTimeFilter(null);
    } else {
      const range = timeRangeRef.current;
      const cutoff = range[0] + (range[1] - range[0]) * (pct / 100);
      graphRef.current.applyTimeFilter([range[0], cutoff]);
    }
  }, []);

  const handleTogglePlay = useCallback(() => {
    setIsPlaying((p) => {
      if (!p && animationProgress >= 100) setAnimationProgress(0);
      return !p;
    });
  }, [animationProgress]);

  const loadGraph = useCallback(async (input: string, txLimit?: number, txOffset?: number) => {
    setLoading(true);
    setError("");
    setSelectedNode(null);
    setSelectedEdge(null);
    setCurrentAddress(input);
    setToolMode("select");
    setPathSource(null);
    setAnimationProgress(100);
    setIsPlaying(false);
    try {
      let address = input;
      if (isKnsDomain(input)) {
        const resolved = await resolveDomain(input);
        address = resolved.address;
      }
      const data = await fetchAddressGraph(address, txLimit, txOffset);
      setGraph(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setGraph(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = useCallback(
    (input: string) => {
      window.history.pushState(null, "", `#${input}`);
      loadGraph(input, 100);
    },
    [loadGraph]
  );

  const handleExpandNode = useCallback(
    async (address: string) => {
      if (!graph) return;
      setLoading(true);
      setError("");
      try {
        const expansion = await fetchAddressGraph(address);
        const existingNodeIds = new Set(graph.nodes.map((n) => n.id));
        const existingEdgeIds = new Set(graph.edges.map((e) => e.id));
        const newNodes = expansion.nodes.filter((n) => !existingNodeIds.has(n.id));
        const newEdges = expansion.edges.filter((e) => !existingEdgeIds.has(e.id));
        setGraph({
          ...graph,
          nodes: [...graph.nodes, ...newNodes],
          edges: [...graph.edges, ...newEdges],
          transactions: [...graph.transactions, ...expansion.transactions],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Expansion failed");
      } finally {
        setLoading(false);
      }
    },
    [graph]
  );

  const handleLoadMore = useCallback(async () => {
    if (!graph || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchAddressGraph(graph.center, 500, graph.tx_loaded);
      const existingNodeIds = new Set(graph.nodes.map((n) => n.id));
      const existingEdgeIds = new Set(graph.edges.map((e) => e.id));
      const newNodes = data.nodes.filter((n) => !existingNodeIds.has(n.id));
      const newEdges = data.edges.filter((e) => !existingEdgeIds.has(e.id));
      setGraph({
        ...graph,
        nodes: [...graph.nodes, ...newNodes],
        edges: [...graph.edges, ...newEdges],
        transactions: [...graph.transactions, ...data.transactions],
        tx_loaded: graph.tx_loaded + data.tx_loaded,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [graph, loadingMore]);

  // Node click handler that supports path/taint tool modes
  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    if (!node || !graph) {
      setSelectedNode(node);
      return;
    }

    setRightTab("inspect");

    if (toolMode === "path") {
      if (!pathSource) {
        setPathSource(node.id);
        setSelectedNode(node);
      } else {
        const result = findShortestPath(graph.edges, pathSource, node.id);
        if (result) {
          graphRef.current?.highlightPath(result.nodeIds, result.edgeIds);
        } else {
          setError("No path found between selected nodes");
        }
        setPathSource(null);
        setSelectedNode(node);
      }
      return;
    }

    if (toolMode === "taint") {
      const taint = computeForwardTaint(graph.edges, node.id);
      graphRef.current?.applyTaint(taint);
      setSelectedNode(node);
      return;
    }

    setSelectedNode(node);
  }, [graph, toolMode, pathSource]);

  const handleEdgeSelect = useCallback((edge: GraphEdge | null) => {
    setSelectedEdge(edge);
    if (edge) {
      setSelectedNode(null);
      setRightTab("inspect");
    }
  }, []);

  const handleToolModeChange = useCallback((mode: ToolMode) => {
    setToolMode(mode);
    setPathSource(null);
    graphRef.current?.clearHighlights();
  }, []);

  // Export functions
  const handleExportSVG = useCallback(() => {
    if (!graphRef.current) return;
    const svgStr = graphRef.current.exportSVG();
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    downloadBlob(blob, "kaspa-graph.svg");
  }, []);

  const handleExportPNG = useCallback(async () => {
    if (!graphRef.current) return;
    const blob = await graphRef.current.exportPNG();
    if (blob) downloadBlob(blob, "kaspa-graph.png");
  }, []);

  const handleExportJSON = useCallback(() => {
    if (!graph) return;
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    downloadBlob(blob, "kaspa-graph.json");
  }, [graph]);

  const handleExportCSV = useCallback(() => {
    if (!graph) return;
    const rows = ["source,target,amount_kas,tx_count,first_seen,last_seen"];
    for (const e of graph.edges) {
      rows.push(`${e.source},${e.target},${sompiToKas(e.total_amount)},${e.tx_count},${e.first_seen || ""},${e.last_seen || ""}`);
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    downloadBlob(blob, "kaspa-graph.csv");
  }, [graph]);

  // Case management
  const handleSaveCase = useCallback(() => {
    if (!graph || !caseName.trim()) return;
    const c = createCase(caseName.trim(), graph);
    saveCase(c);
    setCases(listCases());
    setCaseName("");
  }, [graph, caseName]);

  const handleLoadCase = useCallback((c: SavedCase) => {
    setGraph(c.graph);
    setCurrentAddress(c.center);
    setRightTab("inspect");
  }, []);

  const handleDeleteCase = useCallback((id: string) => {
    deleteCase(id);
    setCases(listCases());
  }, []);

  // URL hash handling
  useEffect(() => {
    const addr = getInputFromHash();
    if (addr) loadGraph(addr, 100);
  }, [loadGraph]);

  useEffect(() => {
    function onHashChange() {
      const addr = getInputFromHash();
      if (addr && addr !== currentAddress) {
        loadGraph(addr, 100);
      } else if (!addr) {
        setGraph(null);
        setCurrentAddress("");
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [currentAddress, loadGraph]);

  const hasTimeData = timeRangeRef.current !== null;

  // Compute available protocols from transactions
  const availableProtocols = (() => {
    if (!graph) return [];
    const PROTOCOL_ORDER = ["kas", "krc20", "kns", "krc721", "kasia", "p2sh"];
    const protocols = new Set<string>();
    for (const tx of graph.transactions) {
      const prefix = tx.tx_type.split(":")[0];
      if (PROTOCOL_ORDER.includes(prefix)) protocols.add(prefix);
      else protocols.add(tx.tx_type);
    }
    return PROTOCOL_ORDER.filter((p) => protocols.has(p));
  })();

  return (
    <div className="h-screen flex flex-col relative z-10 md:overflow-hidden overflow-auto">
      {/* Header */}
      <header className="forensics-header px-6 py-4">
        <div className="flex items-center gap-2 md:gap-4 mb-2 md:mb-3 flex-wrap">
          <div className="flex items-center gap-3">
            {/* Logo mark */}
            <div className="relative w-7 h-7 flex items-center justify-center">
              <svg viewBox="0 0 28 28" width="28" height="28" fill="none">
                <path d="M14 2L26 8v12l-12 6L2 20V8l12-6z" stroke="#2ff2a8" strokeWidth="1.5" fill="#2ff2a808" />
                <circle cx="14" cy="14" r="3" fill="#2ff2a8" opacity="0.6" />
                <line x1="14" y1="14" x2="22" y2="8" stroke="#2ff2a8" strokeWidth="0.8" opacity="0.4" />
                <line x1="14" y1="14" x2="6" y2="8" stroke="#2ff2a8" strokeWidth="0.8" opacity="0.4" />
                <line x1="14" y1="14" x2="14" y2="24" stroke="#2ff2a8" strokeWidth="0.8" opacity="0.4" />
                <circle cx="22" cy="8" r="1.5" fill="#2ff2a8" opacity="0.3" />
                <circle cx="6" cy="8" r="1.5" fill="#2ff2a8" opacity="0.3" />
                <circle cx="14" cy="24" r="1.5" fill="#2ff2a8" opacity="0.3" />
              </svg>
            </div>
            <div>
              <h1 className="forensics-title">Kaspa Forensics</h1>
            </div>
          </div>
          <span className="context-badge">DAG Analysis</span>
          <a
            href="https://github.com/kasanova-io/kaspa-trail"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-[var(--color-text-dim)] hover:text-[var(--color-accent)] transition-colors"
            title="View on GitHub"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
          {graph && (
            <span className="mono text-[10px] text-[var(--color-text-muted)] hidden sm:flex items-center gap-2">
              <span className="status-dot status-dot-active" />
              {graph.nodes.length} addresses &middot; {graph.edges.length} flows
              {graph.tx_total > 0 && ` \u00b7 ${graph.tx_total} txs`}
            </span>
          )}
          {toolMode === "path" && pathSource && (
            <span className="hidden sm:inline text-[10px] text-[var(--color-warning)] font-semibold tracking-wide uppercase">
              Select destination node (from {pathSource.split(":")[1]?.slice(0, 6)}...)
            </span>
          )}
          {toolMode === "taint" && (
            <span className="hidden sm:inline text-[10px] text-[var(--color-warning)] font-semibold tracking-wide uppercase">
              Click node to trace taint
            </span>
          )}
        </div>
        {(graph || loading) && <AddressSearch onSearch={handleSearch} loading={loading} />}
        {error && (
          <p className="mt-2 text-xs text-[var(--color-edge-send)] text-center mono tracking-wide">
            {error}
          </p>
        )}
      </header>

      {/* Graph controls toolbar */}
      {graph && (
        <GraphControls
          onExportSVG={handleExportSVG}
          onExportPNG={handleExportPNG}
          onExportJSON={handleExportJSON}
          onExportCSV={handleExportCSV}
          layout={layout}
          onLayoutChange={setLayout}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          toolMode={toolMode}
          onToolModeChange={handleToolModeChange}
          isPlaying={isPlaying}
          onTogglePlay={handleTogglePlay}
          animationProgress={animationProgress}
          onProgressChange={handleProgressChange}
          hasTimeData={hasTimeData}
          txLoaded={graph.tx_loaded}
          txTotal={graph.tx_total}
          onLoadMore={handleLoadMore}
          loadingMore={loadingMore}
          protocolFilter={txTypeFilter}
          onProtocolFilterChange={setTxTypeFilter}
          availableProtocols={availableProtocols}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row md:overflow-hidden">
        {/* Graph area */}
        <div className="flex-1 shrink-0 p-1 md:p-2 relative min-h-[50vh] md:min-h-0">
          {graph ? (
            <GraphView
              ref={graphRef}
              graph={graph}
              onSelectNode={handleNodeSelect}
              onSelectEdge={handleEdgeSelect}
              layout={layout}
              labels={labels}
              protocolFilter={txTypeFilter}
            />
          ) : !loading ? (
            <div className="h-full flex items-center justify-center">
              <div className="empty-state text-center max-w-lg">
                {/* Decorative hex grid */}
                <div className="mb-8 flex justify-center opacity-20">
                  <svg viewBox="0 0 200 60" width="200" height="60" fill="none">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <g key={i} transform={`translate(${i * 40 + (i % 2 ? 0 : 20)}, ${i % 2 ? 0 : 16})`}>
                        <path d="M20 0L38 10v20L20 40 2 30V10L20 0z" stroke="#2ff2a8" strokeWidth="0.5" />
                      </g>
                    ))}
                  </svg>
                </div>
                <p className="empty-state-title mb-6">
                  Ready to investigate
                </p>
                <div className="mb-6 max-w-xl mx-auto">
                  <AddressSearch onSearch={handleSearch} loading={loading} />
                  {error && (
                    <p className="mt-3 text-xs text-[var(--color-edge-send)] text-center mono tracking-wide">
                      {error}
                    </p>
                  )}
                </div>
                <div className="mt-6 flex justify-center gap-6 text-[10px] text-[var(--color-text-dim)]">
                  <span className="flex items-center gap-1.5 uppercase tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-[#2ff2a8] opacity-40" />
                    Graph
                  </span>
                  <span className="flex items-center gap-1.5 uppercase tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-[#ff9f1a] opacity-40" />
                    Entities
                  </span>
                  <span className="flex items-center gap-1.5 uppercase tracking-widest">
                    <span className="w-2 h-2 rounded-full bg-[#ff3a5c] opacity-40" />
                    Patterns
                  </span>
                </div>
                <a
                  href="https://kasanova.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-block text-[10px] text-[var(--color-text-dim)] hover:text-[var(--color-accent)] transition-colors mono tracking-wide"
                >
                  Made with &lt;3 by Kasanova
                </a>
              </div>
            </div>
          ) : null}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center loading-overlay z-10 rounded-lg">
              <div className="loading-spinner flex flex-col items-center gap-4">
                <div className="hex-spinner"></div>
                <span className="text-xs text-[var(--color-text-muted)] tracking-widest uppercase">
                  Tracing transactions
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        {graph && (
          <aside className="w-full md:w-80 sidebar flex flex-col md:overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-[var(--color-border)]">
              {(["inspect", "txs", "cases"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={`flex-1 px-3 py-2.5 tab-btn ${
                    rightTab === tab ? "tab-btn-active" : "tab-btn-inactive"
                  }`}
                >
                  {tab === "txs" ? `Txs (${graph.transactions.length})` : tab === "cases" ? "Cases" : "Inspect"}
                </button>
              ))}
            </div>
            {/* Tab content */}
            <div className="flex-1 overflow-auto">
              {rightTab === "inspect" && (
                <InfoPanel
                  selectedNode={selectedNode}
                  selectedEdge={selectedEdge}
                  onExpandNode={handleExpandNode}
                  prices={prices}
                  onLabelChange={refreshLabels}
                />
              )}
              {rightTab === "txs" && (
                <TxList
                  transactions={graph.transactions}
                  center={graph.center}
                  prices={prices}
                  typeFilter={txTypeFilter}
                  onTypeFilterChange={setTxTypeFilter}
                />
              )}
              {rightTab === "cases" && (
                <div className="p-4 space-y-3 text-xs">
                  <div className="space-y-1">
                    <p className="section-label">Save Investigation</p>
                    <div className="flex gap-1 mt-2">
                      <input
                        type="text"
                        value={caseName}
                        onChange={(e) => setCaseName(e.target.value)}
                        placeholder="Case name..."
                        className="flex-1 px-2 py-1.5 rounded field-input"
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveCase(); }}
                      />
                      <button
                        onClick={handleSaveCase}
                        className="px-3 py-1.5 rounded text-[10px] btn-primary"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  {cases.length > 0 && (
                    <div className="space-y-2">
                      <p className="section-label">Saved Cases ({cases.length})</p>
                      <div className="space-y-1">
                        {cases.map((c) => (
                          <div key={c.id} className="flex items-center justify-between p-2.5 rounded info-card">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate text-[var(--color-text)]">{c.name}</p>
                              <p className="text-[9px] text-[var(--color-text-muted)] mono mt-0.5">
                                {c.graph.nodes.length} nodes &middot; {new Date(c.updated).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex gap-1 ml-2">
                              <button
                                onClick={() => handleLoadCase(c)}
                                className="px-2 py-1 rounded text-[9px] btn-primary"
                              >
                                Load
                              </button>
                              <button
                                onClick={() => handleDeleteCase(c.id)}
                                className="px-2 py-1 rounded text-[9px] btn-danger"
                              >
                                Del
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {cases.length === 0 && (
                    <p className="text-[var(--color-text-dim)] text-center py-6 mono text-[10px] tracking-wide">
                      No saved cases
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

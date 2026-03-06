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
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-4 mb-3">
          <h1 className="text-lg font-bold text-[var(--color-accent)]">
            Kaspa Forensics
          </h1>
          {graph && (
            <span className="text-xs text-[var(--color-text-muted)]">
              {graph.nodes.length} addresses / {graph.edges.length} flows
              {graph.tx_total > 0 && ` / ${graph.tx_total} total txs`}
            </span>
          )}
          {toolMode === "path" && pathSource && (
            <span className="text-xs text-[#ff9f1a] font-bold">
              Click second node for path (from {pathSource.split(":")[1]?.slice(0, 6)}...)
            </span>
          )}
          {toolMode === "taint" && (
            <span className="text-xs text-[#ff9f1a] font-bold">
              Click a node to trace taint
            </span>
          )}
        </div>
        <AddressSearch onSearch={handleSearch} loading={loading} />
        {error && (
          <p className="mt-2 text-sm text-[var(--color-edge-send)] text-center">
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
      <div className="flex-1 flex overflow-hidden">
        {/* Graph area */}
        <div className="flex-1 p-2 relative">
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
              <div className="text-center text-[var(--color-text-muted)]">
                <p className="text-2xl mb-2">Paste an address to begin</p>
                <p className="text-sm">
                  Enter a Kaspa address to visualize its transaction graph
                </p>
              </div>
            </div>
          ) : null}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#08080dcc] z-10 rounded-lg">
              <div className="flex flex-col items-center gap-4">
                <svg className="animate-spin" width="40" height="40" viewBox="0 0 40 40" fill="none">
                  <circle cx="20" cy="20" r="16" stroke="var(--color-border)" strokeWidth="3" />
                  <path d="M36 20a16 16 0 0 0-16-16" stroke="var(--color-accent)" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span className="text-sm text-[var(--color-text-muted)]">Tracing transactions...</span>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        {graph && (
          <aside className="w-80 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-[var(--color-border)]">
              {(["inspect", "txs", "cases"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={`flex-1 px-3 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer ${
                    rightTab === tab
                      ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
                    <p className="text-[var(--color-text-muted)] font-bold uppercase tracking-wider">Save Investigation</p>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={caseName}
                        onChange={(e) => setCaseName(e.target.value)}
                        placeholder="Case name..."
                        className="flex-1 px-2 py-1 rounded bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] text-[10px] focus:outline-none focus:border-[var(--color-accent)]"
                        onKeyDown={(e) => { if (e.key === "Enter") handleSaveCase(); }}
                      />
                      <button
                        onClick={handleSaveCase}
                        className="px-2 py-1 rounded bg-[var(--color-accent-dim)] text-[var(--color-accent)] text-[10px] font-bold cursor-pointer hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  {cases.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[var(--color-text-muted)] font-bold uppercase tracking-wider">Saved Cases ({cases.length})</p>
                      <div className="space-y-1">
                        {cases.map((c) => (
                          <div key={c.id} className="flex items-center justify-between p-2 rounded bg-[var(--color-bg)]">
                            <div className="flex-1 min-w-0">
                              <p className="font-bold truncate">{c.name}</p>
                              <p className="text-[9px] text-[var(--color-text-muted)]">
                                {c.graph.nodes.length} nodes / {new Date(c.updated).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex gap-1 ml-2">
                              <button
                                onClick={() => handleLoadCase(c)}
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--color-accent-dim)] text-[var(--color-accent)] cursor-pointer hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]"
                              >
                                Load
                              </button>
                              <button
                                onClick={() => handleDeleteCase(c.id)}
                                className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#ff446622] text-[#ff4466] cursor-pointer hover:bg-[#ff4466] hover:text-[var(--color-bg)]"
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
                    <p className="text-[var(--color-text-muted)] text-center py-4">No saved cases yet</p>
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

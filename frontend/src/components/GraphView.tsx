// ABOUTME: Interactive graph visualization using D3.js force simulation with SVG rendering.
// ABOUTME: Supports time filtering, path highlighting, taint coloring, radial layout, and export.

"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import * as d3 from "d3";
import { sompiToKas, type AddressGraph, type GraphNode, type GraphEdge } from "@/lib/api";
import type { TaintMap } from "@/lib/graphAnalysis";
import type { LayoutType } from "./GraphControls";

export interface GraphViewHandle {
  exportSVG: () => string;
  exportPNG: () => Promise<Blob | null>;
  applyTimeFilter: (range: [number, number] | null) => void;
  highlightPath: (nodeIds: string[], edgeIds: string[]) => void;
  applyTaint: (taint: TaintMap | null) => void;
  highlightSearch: (query: string) => void;
  clearHighlights: () => void;
}

interface GraphViewProps {
  graph: AddressGraph | null;
  onSelectNode: (node: GraphNode | null) => void;
  onSelectEdge: (edge: GraphEdge | null) => void;
  layout: LayoutType;
  labels: Record<string, string>;
  protocolFilter: string;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  data: GraphNode;
  radius: number;
  isP2sh: boolean;
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  data: GraphEdge;
  color: string;
  width: number;
  label: string;
}

function nodeRadius(n: GraphNode): number {
  if (n.is_center) return 25;
  if (n.addr_type === "p2sh") return 7;
  // Scale by balance (sompi). log10 of KAS amount gives a nice 0-8 range for most addresses.
  const bal = n.balance ?? 0;
  if (bal > 0) {
    const kas = bal / 1e8;
    return Math.max(10, Math.min(30, 8 + Math.log10(kas + 1) * 4));
  }
  if (n.name) return 16;
  return 10;
}

function edgeColor(e: GraphEdge, center: string): string {
  if (e.target === center) return "#2ff2a8";
  if (e.source === center) return "#ff4466";
  return "#556688";
}

function nodeColor(n: GraphNode): string {
  if (n.is_center) return "#2ff2a8";
  if (n.name) return "#ff9f1a";
  if (n.addr_type === "p2sh") return "#cc66ff";
  return "#3366aa";
}

function nodeBorderColor(n: GraphNode): string {
  if (n.is_center) return "#0d4a33";
  if (n.name) return "#aa6600";
  if (n.addr_type === "p2sh") return "#6633aa";
  return "#1a1a2e";
}

function patternBadge(patterns: string[]): string {
  if (patterns.includes("peel_chain")) return "⛓";
  if (patterns.includes("fan_out")) return "⤴";
  if (patterns.includes("fan_in")) return "⤵";
  if (patterns.includes("dust")) return "•";
  return "";
}

function edgeMatchesProtocol(e: GraphEdge, protocol: string): boolean {
  if (protocol === "all") return true;
  return Object.keys(e.tx_types).some((t) => t === protocol || t.startsWith(protocol + ":"));
}

const GraphView = forwardRef<GraphViewHandle, GraphViewProps>(function GraphView(
  { graph, onSelectNode, onSelectEdge, layout, labels, protocolFilter },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimEdge> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const highlightRef = useRef<string | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  const nodesDataRef = useRef<SimNode[]>([]);
  const edgesDataRef = useRef<SimEdge[]>([]);
  const minimapSvgRef = useRef<SVGSVGElement | null>(null);
  const minimapTransformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  onSelectNodeRef.current = onSelectNode;
  onSelectEdgeRef.current = onSelectEdge;

  const updateMinimap = useCallback(() => {
    const mmSvg = minimapSvgRef.current;
    if (!mmSvg) return;
    const nodes = nodesDataRef.current;
    if (!nodes.length) return;
    // Compute bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0, y = n.y ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const vw = maxX - minX || 1, vh = maxY - minY || 1;
    mmSvg.setAttribute("viewBox", `${minX} ${minY} ${vw} ${vh}`);
    // Render dots
    const mm = d3.select(mmSvg);
    mm.selectAll("circle").remove();
    for (const n of nodes) {
      mm.append("circle")
        .attr("cx", n.x ?? 0).attr("cy", n.y ?? 0)
        .attr("r", Math.max(vw, vh) * 0.006)
        .attr("fill", n.data.is_center ? "#2ff2a8" : n.data.addr_type === "p2sh" ? "#cc66ff" : "#6699dd")
        .attr("opacity", 0.7);
    }
  }, []);

  const updateMinimapViewport = useCallback((canvasW: number, canvasH: number) => {
    const mmSvg = minimapSvgRef.current;
    if (!mmSvg) return;
    const mm = d3.select(mmSvg);
    mm.select(".mm-viewport").remove();
    const t = minimapTransformRef.current;
    // Invert the visible rectangle corners from screen to graph coordinates
    const x0 = t.invertX(0), y0 = t.invertY(0);
    const x1 = t.invertX(canvasW), y1 = t.invertY(canvasH);
    mm.append("rect").attr("class", "mm-viewport")
      .attr("x", x0).attr("y", y0)
      .attr("width", x1 - x0).attr("height", y1 - y0)
      .attr("fill", "none").attr("stroke", "#2ff2a8").attr("stroke-width", (x1 - x0) * 0.008)
      .attr("rx", (x1 - x0) * 0.01).attr("opacity", 0.5);
  }, []);

  // Imperative methods for parent to control visuals
  useImperativeHandle(ref, () => ({
    exportSVG() {
      const svg = svgRef.current;
      if (!svg) return "";
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      return new XMLSerializer().serializeToString(clone);
    },
    async exportPNG() {
      const svg = svgRef.current;
      if (!svg) return null;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const svgData = new XMLSerializer().serializeToString(clone);
      const img = new Image();
      const blob = new Blob([svgData], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      return new Promise<Blob | null>((resolve) => {
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width * 2;
          canvas.height = img.height * 2;
          const ctx = canvas.getContext("2d")!;
          ctx.scale(2, 2);
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(resolve, "image/png");
          URL.revokeObjectURL(url);
        };
        img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
        img.src = url;
      });
    },
    applyTimeFilter(range) {
      const svg = svgRef.current;
      if (!svg) return;
      const s = d3.select(svg);
      if (!range) {
        s.selectAll(".node-group").transition().duration(200).style("opacity", 0.9);
        s.selectAll(".edge-group").transition().duration(200).style("opacity", 0.6);
        return;
      }
      s.selectAll<SVGGElement, SimEdge>(".edge-group")
        .transition().duration(200)
        .style("opacity", (d) => {
          const e = d.data;
          return (e.first_seen <= range[1] && e.last_seen >= range[0]) ? 0.6 : 0.03;
        });
      const visibleNodes = new Set<string>();
      edgesDataRef.current.forEach((d) => {
        const e = d.data;
        if (e.first_seen <= range[1] && e.last_seen >= range[0]) {
          visibleNodes.add((d.source as SimNode).id);
          visibleNodes.add((d.target as SimNode).id);
        }
      });
      s.selectAll<SVGGElement, SimNode>(".node-group")
        .transition().duration(200)
        .style("opacity", (d) => visibleNodes.has(d.id) || d.data.is_center ? 0.9 : 0.05);
    },
    highlightPath(nodeIds, edgeIds) {
      const svg = svgRef.current;
      if (!svg) return;
      const s = d3.select(svg);
      const nSet = new Set(nodeIds);
      const eSet = new Set(edgeIds);
      s.selectAll<SVGGElement, SimNode>(".node-group")
        .transition().duration(200)
        .style("opacity", (d) => nSet.has(d.id) ? 1 : 0.1);
      s.selectAll<SVGGElement, SimEdge>(".edge-group")
        .transition().duration(200)
        .style("opacity", (d) => eSet.has(d.id) ? 1 : 0.03);
    },
    applyTaint(taint) {
      const svg = svgRef.current;
      if (!svg) return;
      const s = d3.select(svg);
      if (!taint) {
        s.selectAll(".node-group").transition().duration(200).style("opacity", 0.9);
        s.selectAll(".edge-group").transition().duration(200).style("opacity", 0.6);
        s.selectAll(".node-shape").attr("stroke", "").attr("stroke-width", "");
        return;
      }
      s.selectAll<SVGGElement, SimNode>(".node-group")
        .transition().duration(200)
        .style("opacity", (d) => (taint[d.id] ?? 0) > 0.001 ? 1 : 0.1);
      // Color by taint intensity
      s.selectAll<SVGGElement, SimNode>(".node-group").each(function (d) {
        const t = taint[d.id] ?? 0;
        if (t > 0.001) {
          d3.select(this).select(".node-shape")
            .attr("stroke", d3.interpolateYlOrRd(Math.min(t, 1)))
            .attr("stroke-width", 3);
        }
      });
      s.selectAll<SVGGElement, SimEdge>(".edge-group")
        .transition().duration(200)
        .style("opacity", (d) => {
          const srcT = taint[(d.source as SimNode).id] ?? 0;
          return srcT > 0.001 ? 0.8 : 0.03;
        });
    },
    highlightSearch(query) {
      const svg = svgRef.current;
      if (!svg) return;
      const s = d3.select(svg);
      if (!query) {
        s.selectAll(".node-group").transition().duration(150).style("opacity", 0.9);
        s.selectAll(".edge-group").transition().duration(150).style("opacity", 0.6);
        return;
      }
      const q = query.toLowerCase();
      const matching = new Set<string>();
      nodesDataRef.current.forEach((n) => {
        if (n.id.includes(q) || n.data.label.toLowerCase().includes(q) ||
            (n.data.name && n.data.name.toLowerCase().includes(q))) {
          matching.add(n.id);
        }
      });
      s.selectAll<SVGGElement, SimNode>(".node-group")
        .transition().duration(150)
        .style("opacity", (d) => matching.has(d.id) ? 1 : 0.1);
      s.selectAll<SVGGElement, SimEdge>(".edge-group")
        .transition().duration(150)
        .style("opacity", (d) => {
          const src = (d.source as SimNode).id;
          const tgt = (d.target as SimNode).id;
          return matching.has(src) || matching.has(tgt) ? 0.8 : 0.03;
        });
    },
    clearHighlights() {
      const svg = svgRef.current;
      if (!svg) return;
      const s = d3.select(svg);
      s.selectAll(".node-group").transition().duration(150).style("opacity", 0.9);
      s.selectAll(".edge-group").transition().duration(150).style("opacity", 0.6);
      s.selectAll(".node-shape").attr("stroke", "").attr("stroke-width", "");
    },
  }));

  const highlightByFilter = useCallback((filter: string | null) => {
    const svg = svgRef.current;
    if (!svg) return;
    const s = d3.select(svg);
    if (highlightRef.current === filter || !filter) {
      highlightRef.current = null;
      s.selectAll<SVGGElement, SimNode>(".node-group").transition().duration(150).style("opacity", 0.9);
      s.selectAll<SVGGElement, SimEdge>(".edge-group").transition().duration(150).style("opacity", 0.6);
      return;
    }
    highlightRef.current = filter;
    const matchNode = (d: SimNode): boolean => {
      switch (filter) {
        case "p2pk": return !d.isP2sh && !d.data.is_center;
        case "p2sh": return d.isP2sh;
        case "named": return !!d.data.name;
        case "center": return d.data.is_center;
        case "peel_chain": return d.data.patterns.includes("peel_chain");
        case "fan_out": return d.data.patterns.includes("fan_out");
        case "fan_in": return d.data.patterns.includes("fan_in");
        case "dust": return d.data.patterns.includes("dust");
        default: return false;
      }
    };
    const matchEdge = (d: SimEdge): boolean => {
      switch (filter) {
        case "incoming": return d.color === "#2ff2a8";
        case "outgoing": return d.color === "#ff4466";
        case "other": return d.color === "#556688";
        case "change": return d.data.is_change;
        default: {
          const src = d.source as SimNode;
          const tgt = d.target as SimNode;
          return matchNode(src) || matchNode(tgt);
        }
      }
    };
    const connectedNodeIds = new Set<string>();
    if (["incoming", "outgoing", "other", "change"].includes(filter)) {
      s.selectAll<SVGGElement, SimEdge>(".edge-group").each((d) => {
        if (matchEdge(d)) {
          connectedNodeIds.add((d.source as SimNode).id);
          connectedNodeIds.add((d.target as SimNode).id);
        }
      });
    }
    s.selectAll<SVGGElement, SimNode>(".node-group")
      .transition().duration(150)
      .style("opacity", (d) => {
        if (connectedNodeIds.size > 0) return connectedNodeIds.has(d.id) ? 1 : 0.1;
        return matchNode(d) ? 1 : 0.1;
      });
    s.selectAll<SVGGElement, SimEdge>(".edge-group")
      .transition().duration(150)
      .style("opacity", (d) => matchEdge(d) ? 1 : 0.05);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !graph) return;
    if (simulationRef.current) { simulationRef.current.stop(); simulationRef.current = null; }
    highlightRef.current = null;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    d3.select(container).select("svg").remove();

    const svg = d3.select(container)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("background", "#08080d")
      .style("border-radius", "0.5rem");

    svgRef.current = svg.node();

    // Arrow markers
    svg.append("defs").selectAll("marker")
      .data(["#2ff2a8", "#ff4466", "#556688"])
      .join("marker")
      .attr("id", (d) => `arrow-${d.replace("#", "")}`)
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 8).attr("refY", 0)
      .attr("markerWidth", 6).attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path").attr("d", "M0,-4L8,0L0,4").attr("fill", (d) => d);

    const g = svg.append("g");
    gRef.current = g.node();

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
        minimapTransformRef.current = event.transform;
        updateMinimapViewport(width, height);
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    // Filter self-loops
    const filteredEdges = graph.edges.filter((e) => e.source !== e.target);

    const nodes: SimNode[] = graph.nodes.map((n) => ({
      id: n.id,
      data: n,
      radius: nodeRadius(n),
      isP2sh: n.addr_type === "p2sh",
      ...(n.is_center ? { fx: width / 2, fy: height / 2 } : {}),
    }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    const edges: SimEdge[] = filteredEdges.map((e) => ({
      id: e.id,
      source: nodeMap.get(e.source)!,
      target: nodeMap.get(e.target)!,
      data: e,
      color: edgeColor(e, graph.center),
      width: Math.max(1.5, Math.min(6, Math.log10(e.total_amount / 1e8 + 1) * 2.5)),
      label: sompiToKas(e.total_amount),
    }));

    nodesDataRef.current = nodes;
    edgesDataRef.current = edges;

    // Edges
    const edgeGroup = g.append("g").attr("class", "edges")
      .selectAll<SVGGElement, SimEdge>("g").data(edges).join("g")
      .attr("class", "edge-group").style("opacity", 0.6).style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        onSelectEdgeRef.current(d.data);
        onSelectNodeRef.current(null);
      });

    const edgeLines = edgeGroup.append("line")
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", (d) => d.width)
      .attr("marker-end", (d) => `url(#arrow-${d.color.replace("#", "")})`);

    edgeGroup.append("text")
      .text((d) => d.label)
      .attr("font-size", "7px").attr("font-family", "JetBrains Mono, monospace")
      .attr("fill", "#8888a0").attr("text-anchor", "middle").attr("dy", -6)
      .style("paint-order", "stroke").style("stroke", "#08080d").style("stroke-width", "3px")
      .style("pointer-events", "none")
      .attr("class", "edge-label");

    // Nodes
    const nodeGroup = g.append("g").attr("class", "nodes")
      .selectAll<SVGGElement, SimNode>("g").data(nodes).join("g")
      .attr("class", "node-group").style("opacity", 0.9).style("cursor", "pointer")
      .on("mouseenter", (_event, d) => {
        edgeGroup.transition().duration(150)
          .style("opacity", (e) => {
            const src = (e.source as SimNode).id;
            const tgt = (e.target as SimNode).id;
            return src === d.id || tgt === d.id ? 1 : 0.1;
          });
      })
      .on("mouseleave", () => {
        if (!highlightRef.current) {
          const pf = protocolFilterRef.current;
          if (pf === "all") {
            edgeGroup.transition().duration(150).style("opacity", 0.6);
          } else {
            edgeGroup.transition().duration(150)
              .style("opacity", (e) => edgeMatchesProtocol(e.data, pf) ? 0.8 : 0.04);
          }
        }
      });

    // Drag
    const drag = d3.drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        if (!d.data.is_center) { d.fx = null; d.fy = null; }
      });
    nodeGroup.call(drag);

    // Click handler — registered AFTER drag so it coexists
    nodeGroup.on("click", (event, d) => {
      event.stopPropagation();
      onSelectNodeRef.current(d.data);
      onSelectEdgeRef.current(null);
    });

    // Draw shapes
    nodeGroup.each(function (d) {
      const el = d3.select(this);
      if (d.isP2sh) {
        const s = d.radius * 1.4;
        el.append("rect").attr("class", "node-shape")
          .attr("width", s).attr("height", s)
          .attr("x", -s / 2).attr("y", -s / 2)
          .attr("transform", "rotate(45)")
          .attr("fill", nodeColor(d.data))
          .attr("stroke", nodeBorderColor(d.data)).attr("stroke-width", 2).attr("rx", 1);
      } else {
        el.append("circle").attr("class", "node-shape")
          .attr("r", d.radius)
          .attr("fill", nodeColor(d.data))
          .attr("stroke", nodeBorderColor(d.data))
          .attr("stroke-width", d.data.is_center ? 3 : d.data.name ? 2.5 : 2);
      }
      // Pattern badge
      const badge = patternBadge(d.data.patterns);
      if (badge) {
        el.append("text").text(badge)
          .attr("font-size", "10px").attr("text-anchor", "middle")
          .attr("dy", -d.radius - 4).style("pointer-events", "none");
      }
    });

    // Labels (with community labels override)
    nodeGroup.append("text")
      .text((d) => labels[d.id] || d.data.label)
      .attr("font-size", (d) => d.data.is_center ? "11px" : d.data.name ? "10px" : d.isP2sh ? "7px" : "9px")
      .attr("font-family", "JetBrains Mono, monospace")
      .attr("font-weight", (d) => (d.data.is_center || d.data.name) ? "bold" : "normal")
      .attr("fill", (d) => labels[d.id] ? "#ff66aa" : (d.data.is_center || d.data.name) ? "#ffffff" : "#c0c0d0")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => d.radius + 14)
      .style("paint-order", "stroke")
      .style("stroke", "#0a0a0f")
      .style("stroke-width", (d) => d.data.is_center ? "3px" : "2px")
      .style("pointer-events", "none");

    svg.on("click", () => { onSelectNodeRef.current(null); onSelectEdgeRef.current(null); });

    // Force simulation
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force("link", d3.forceLink<SimNode, SimEdge>(edges).id((d) => d.id).distance(180))
      .force("charge", d3.forceManyBody<SimNode>().strength((d) => d.data.is_center ? -800 : -400))
      .force("collision", d3.forceCollide<SimNode>().radius((d) => d.radius + 20))
      .alphaDecay(0.02);

    if (layout === "radial") {
      simulation.force("center", null);
      simulation.force("radial", d3.forceRadial<SimNode>(200, width / 2, height / 2)
        .strength((d) => d.data.is_center ? 0 : 0.3));
    } else {
      simulation.force("center", d3.forceCenter(width / 2, height / 2));
      simulation.force("radial", null);
    }

    simulationRef.current = simulation;

    let tickCount = 0;
    simulation.on("tick", () => {
      edgeLines
        .attr("x1", (d) => (d.source as SimNode).x!)
        .attr("y1", (d) => (d.source as SimNode).y!)
        .attr("x2", (d) => {
          const src = d.source as SimNode; const tgt = d.target as SimNode;
          const dx = tgt.x! - src.x!; const dy = tgt.y! - src.y!;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return tgt.x! - (dx / dist) * tgt.radius;
        })
        .attr("y2", (d) => {
          const src = d.source as SimNode; const tgt = d.target as SimNode;
          const dx = tgt.x! - src.x!; const dy = tgt.y! - src.y!;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          return tgt.y! - (dy / dist) * tgt.radius;
        });
      g.selectAll<SVGTextElement, SimEdge>(".edge-label")
        .attr("x", (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr("y", (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);
      nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
      if (++tickCount % 5 === 0) updateMinimap();
    });

    simulation.on("end", () => {
      updateMinimap();
      updateMinimapViewport(width, height);
      const bounds = (g.node() as SVGGElement).getBBox();
      const pad = 60;
      const scale = Math.min(width / (bounds.width + pad * 2), height / (bounds.height + pad * 2), 1.5);
      const tx = width / 2 - (bounds.x + bounds.width / 2) * scale;
      const ty = height / 2 - (bounds.y + bounds.height / 2) * scale;
      svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
      d3.select(container).select("svg").remove();
      svgRef.current = null; gRef.current = null;
    };
  }, [graph, layout, labels, updateMinimap, updateMinimapViewport]);

  // Apply protocol filter
  const protocolFilterRef = useRef(protocolFilter);
  protocolFilterRef.current = protocolFilter;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !graph) return;
    const s = d3.select(svg);
    if (protocolFilter === "all") {
      s.selectAll(".node-group").transition().duration(200).style("opacity", 0.9);
      s.selectAll(".edge-group").transition().duration(200).style("opacity", 0.6);
      return;
    }
    const visibleNodes = new Set<string>();
    edgesDataRef.current.forEach((d) => {
      if (edgeMatchesProtocol(d.data, protocolFilter)) {
        visibleNodes.add((d.source as SimNode).id);
        visibleNodes.add((d.target as SimNode).id);
      }
    });
    s.selectAll<SVGGElement, SimEdge>(".edge-group")
      .transition().duration(200)
      .style("opacity", (d) => edgeMatchesProtocol(d.data, protocolFilter) ? 0.8 : 0.04);
    s.selectAll<SVGGElement, SimNode>(".node-group")
      .transition().duration(200)
      .style("opacity", (d) => visibleNodes.has(d.id) || d.data.is_center ? 0.9 : 0.06);
  }, [protocolFilter, graph]);

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full rounded-lg border border-[var(--color-border)]" />
      {/* Legend */}
      {graph && (
        <div className="absolute bottom-3 left-3 flex gap-1 text-[10px] text-[var(--color-text-muted)] bg-[#08080dcc] backdrop-blur-sm rounded px-2 py-1.5 border border-[var(--color-border)] flex-wrap max-w-[600px]">
          {[
            { key: "incoming", swatch: <span className="w-3 h-0.5 bg-[#2ff2a8] inline-block rounded" />, label: "In" },
            { key: "outgoing", swatch: <span className="w-3 h-0.5 bg-[#ff4466] inline-block rounded" />, label: "Out" },
            { key: "other", swatch: <span className="w-3 h-0.5 bg-[#556688] inline-block rounded" />, label: "Other" },
            { key: "p2pk", swatch: <span className="w-2.5 h-2.5 bg-[#3366aa] inline-block rounded-full" />, label: "P2PK" },
            { key: "p2sh", swatch: <span className="w-2.5 h-2.5 bg-[#cc66ff] inline-block rotate-45" />, label: "P2SH" },
            { key: "named", swatch: <span className="w-2.5 h-2.5 bg-[#ff9f1a] inline-block rounded-full" />, label: "Named" },
            { key: "center", swatch: <span className="w-2.5 h-2.5 bg-[#2ff2a8] inline-block rounded-full" />, label: "Center" },
            { key: "peel_chain", swatch: <span className="inline-block">⛓</span>, label: "Peel" },
            { key: "fan_out", swatch: <span className="inline-block">⤴</span>, label: "Fan-out" },
            { key: "fan_in", swatch: <span className="inline-block">⤵</span>, label: "Fan-in" },
          ].map(({ key, swatch, label }) => (
            <button key={key} onClick={() => highlightByFilter(key)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer">
              {swatch}
              {label}
            </button>
          ))}
        </div>
      )}
      {/* Minimap — D3-managed, updates on simulation tick */}
      {graph && (
        <div className="absolute top-3 right-3 w-[140px] h-[90px] bg-[#08080dcc] backdrop-blur-sm rounded border border-[var(--color-border)] overflow-hidden">
          <svg ref={minimapSvgRef} className="w-full h-full" preserveAspectRatio="xMidYMid meet" />
        </div>
      )}
    </div>
  );
});

export default GraphView;

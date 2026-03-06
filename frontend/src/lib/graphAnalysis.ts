// ABOUTME: Client-side graph analysis algorithms.
// ABOUTME: Shortest path (BFS), forward taint analysis, and time windowing.

import type { GraphNode, GraphEdge } from "./api";

interface AdjEntry {
  target: string;
  edge: GraphEdge;
}

function buildAdjacency(edges: GraphEdge[]): Map<string, AdjEntry[]> {
  const adj = new Map<string, AdjEntry[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push({ target: e.target, edge: e });
    // Undirected for path finding
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.target)!.push({ target: e.source, edge: e });
  }
  return adj;
}

export interface PathResult {
  nodeIds: string[];
  edgeIds: string[];
  totalAmount: number;
}

export function findShortestPath(
  edges: GraphEdge[],
  sourceId: string,
  targetId: string
): PathResult | null {
  if (sourceId === targetId) return null;

  const adj = buildAdjacency(edges);
  const visited = new Set<string>();
  const parent = new Map<string, { from: string; edge: GraphEdge }>();
  const queue: string[] = [sourceId];
  visited.add(sourceId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      // Reconstruct path
      const nodeIds: string[] = [];
      const edgeIds: string[] = [];
      let totalAmount = 0;
      let node = targetId;
      while (node !== sourceId) {
        nodeIds.unshift(node);
        const p = parent.get(node)!;
        edgeIds.unshift(p.edge.id);
        totalAmount += p.edge.total_amount;
        node = p.from;
      }
      nodeIds.unshift(sourceId);
      return { nodeIds, edgeIds, totalAmount };
    }

    for (const { target, edge } of adj.get(current) || []) {
      if (!visited.has(target)) {
        visited.add(target);
        parent.set(target, { from: current, edge });
        queue.push(target);
      }
    }
  }

  return null;
}

export interface TaintMap {
  [nodeId: string]: number; // 0 to 1 taint level
}

export function computeForwardTaint(
  edges: GraphEdge[],
  sourceId: string
): TaintMap {
  // Forward proportional taint from source
  const directedAdj = new Map<string, { target: string; amount: number }[]>();
  const totalOut = new Map<string, number>();

  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!directedAdj.has(e.source)) directedAdj.set(e.source, []);
    directedAdj.get(e.source)!.push({ target: e.target, amount: e.total_amount });
    totalOut.set(e.source, (totalOut.get(e.source) || 0) + e.total_amount);
  }

  const taint: TaintMap = { [sourceId]: 1.0 };
  const visited = new Set<string>();
  const queue: string[] = [sourceId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const outTotal = totalOut.get(current) || 0;
    if (outTotal === 0) continue;

    const currentTaint = taint[current] || 0;
    for (const { target, amount } of directedAdj.get(current) || []) {
      const proportion = amount / outTotal;
      const newTaint = currentTaint * proportion;
      taint[target] = (taint[target] || 0) + newTaint;
      if (!visited.has(target)) {
        queue.push(target);
      }
    }
  }

  return taint;
}

export function getTimeRange(
  edges: GraphEdge[]
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const e of edges) {
    if (e.first_seen && e.first_seen < min) min = e.first_seen;
    if (e.last_seen && e.last_seen > max) max = e.last_seen;
  }
  if (min === Infinity) return null;
  return [min, max];
}

export function filterEdgesByTime(
  edges: GraphEdge[],
  timeRange: [number, number]
): Set<string> {
  const visible = new Set<string>();
  for (const e of edges) {
    if (e.first_seen <= timeRange[1] && e.last_seen >= timeRange[0]) {
      visible.add(e.id);
    }
  }
  return visible;
}

export function getConnectedNodes(
  edges: GraphEdge[],
  visibleEdgeIds: Set<string>
): Set<string> {
  const nodes = new Set<string>();
  for (const e of edges) {
    if (visibleEdgeIds.has(e.id)) {
      nodes.add(e.source);
      nodes.add(e.target);
    }
  }
  return nodes;
}

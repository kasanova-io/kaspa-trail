// ABOUTME: API client for the forensics backend.
// ABOUTME: Fetches address info, graph data, and prices via the Next.js proxy.

export interface GraphNode {
  id: string;
  label: string;
  name: string | null;
  addr_type: "p2pk" | "p2sh";
  balance: number | null;
  tx_count: number;
  is_center: boolean;
  patterns: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  total_amount: number;
  tx_count: number;
  tx_ids: string[];
  is_change: boolean;
  first_seen: number;
  last_seen: number;
  tx_types: Record<string, number>; // {"kas": 3, "krc20:transfer": 2}
}

export interface TxSummary {
  tx_id: string;
  block_time: number;
  inputs: string[];
  outputs: string[];
  amounts: number[];
  tx_type: string; // "kas", "krc20:mint", "krc20:transfer", "kns:create", etc.
}

export interface AddressGraph {
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  transactions: TxSummary[];
  tx_total: number;
  tx_loaded: number;
  krc20_tokens: string[];
}

export interface AddressInfo {
  address: string;
  balance: number;
  tx_count: number;
}

export interface TokenHolding {
  tick: string;
  balance: string;
  decimals: number;
}

export interface DomainHolding {
  name: string;
  status: string;
}

export interface AddressDetails {
  address: string;
  balance: number;
  tx_count: number;
  first_tx_time: number | null;
  last_tx_time: number | null;
  primary_domain: string | null;
  domains: DomainHolding[];
  tokens: TokenHolding[];
}

export interface PricePoint {
  timestamp: number;
  price_usd: number;
}

const SOMPI_PER_KAS = 100_000_000;

export const EXPLORER_BASE_URL = "https://kaspa.stream";

export function sompiToKas(sompi: number): string {
  const kas = sompi / SOMPI_PER_KAS;
  if (kas >= 1_000_000) return `${(kas / 1_000_000).toFixed(2)}M`;
  if (kas >= 1_000) return `${(kas / 1_000).toFixed(2)}K`;
  return kas.toFixed(2);
}

export function sompiToKasNum(sompi: number): number {
  return sompi / SOMPI_PER_KAS;
}

export async function fetchAddressGraph(
  address: string,
  txLimit?: number,
  txOffset?: number
): Promise<AddressGraph> {
  const params = new URLSearchParams();
  if (txLimit) params.set("tx_limit", String(txLimit));
  if (txOffset) params.set("tx_offset", String(txOffset));
  const qs = params.toString() ? `?${params}` : "";
  const resp = await fetch(`/api/address/${address}/graph${qs}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || "Failed to fetch graph");
  }
  return resp.json();
}

export async function resolveDomain(
  domain: string
): Promise<{ address: string; domain: string }> {
  const resp = await fetch(`/api/resolve/${domain}`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || "Domain not found");
  }
  return resp.json();
}

export function isKnsDomain(input: string): boolean {
  return /^[a-z0-9\-]+\.kas$/i.test(input);
}

export async function fetchAddressInfo(
  address: string
): Promise<AddressInfo> {
  const resp = await fetch(`/api/address/${address}/info`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || "Failed to fetch address info");
  }
  return resp.json();
}

export async function fetchAddressDetails(
  address: string
): Promise<AddressDetails> {
  const resp = await fetch(`/api/address/${address}/details`);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || "Failed to fetch address details");
  }
  return resp.json();
}

export async function fetchPriceRange(
  fromTs: number,
  toTs: number
): Promise<PricePoint[]> {
  const resp = await fetch(`/api/price/range?from_ts=${fromTs}&to_ts=${toTs}`);
  if (!resp.ok) return [];
  return resp.json();
}

export async function fetchCurrentPrice(): Promise<number | null> {
  const resp = await fetch("/api/price/current");
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.price_usd ?? null;
}

export function interpolatePrice(
  prices: PricePoint[],
  timestamp: number
): number | null {
  if (prices.length === 0) return null;
  if (timestamp <= prices[0].timestamp) return prices[0].price_usd;
  if (timestamp >= prices[prices.length - 1].timestamp)
    return prices[prices.length - 1].price_usd;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i].timestamp >= timestamp) {
      const prev = prices[i - 1];
      const next = prices[i];
      const ratio = (timestamp - prev.timestamp) / (next.timestamp - prev.timestamp);
      return prev.price_usd + ratio * (next.price_usd - prev.price_usd);
    }
  }
  return null;
}

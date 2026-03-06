// ABOUTME: LocalStorage-based case management and community labels.
// ABOUTME: Persists investigation notes, address labels, and saved graph states.

import type { AddressGraph } from "./api";

const CASES_KEY = "kaspa_forensics_cases";
const LABELS_KEY = "kaspa_forensics_labels";

export interface CaseNote {
  address: string;
  note: string;
  updated: number;
}

export interface SavedCase {
  id: string;
  name: string;
  center: string;
  notes: CaseNote[];
  labels: Record<string, string>;
  graph: AddressGraph;
  created: number;
  updated: number;
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Cases ---

export function listCases(): SavedCase[] {
  return loadJson<SavedCase[]>(CASES_KEY, []);
}

export function saveCase(c: SavedCase): void {
  const cases = listCases().filter((x) => x.id !== c.id);
  cases.unshift(c);
  saveJson(CASES_KEY, cases);
}

export function deleteCase(id: string): void {
  const cases = listCases().filter((x) => x.id !== id);
  saveJson(CASES_KEY, cases);
}

export function createCase(name: string, graph: AddressGraph): SavedCase {
  const now = Date.now();
  return {
    id: `case_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    center: graph.center,
    notes: [],
    labels: {},
    graph,
    created: now,
    updated: now,
  };
}

// --- Community Labels ---

export function getLabels(): Record<string, string> {
  return loadJson<Record<string, string>>(LABELS_KEY, {});
}

export function setLabel(address: string, label: string): void {
  const labels = getLabels();
  if (label.trim()) {
    labels[address] = label.trim();
  } else {
    delete labels[address];
  }
  saveJson(LABELS_KEY, labels);
}

export function getLabel(address: string): string {
  return getLabels()[address] || "";
}

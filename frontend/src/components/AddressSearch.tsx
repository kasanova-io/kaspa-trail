// ABOUTME: Search bar component for entering a Kaspa address or .kas domain.
// ABOUTME: Validates address format or KNS domain before submitting.

"use client";

import { useState } from "react";
import { isKnsDomain } from "@/lib/api";

interface AddressSearchProps {
  onSearch: (input: string) => void;
  loading: boolean;
}

const KASPA_ADDR_RE = /^kaspa:[a-z0-9]{61,63}$/;

export default function AddressSearch({ onSearch, loading }: AddressSearchProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim().toLowerCase();
    if (KASPA_ADDR_RE.test(trimmed) || isKnsDomain(trimmed)) {
      setError("");
      onSearch(trimmed);
      return;
    }
    setError("Enter a Kaspa address or .kas domain");
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      <div className="search-container flex gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-dim)] text-[10px] tracking-widest uppercase select-none pointer-events-none">
            &gt;
          </span>
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError("");
            }}
            placeholder="Enter a kaspa address or .kas domain to start"
            className="w-full pl-8 pr-4 py-3 rounded-lg search-input"
            disabled={loading}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 rounded-lg search-button
            disabled:opacity-50 disabled:cursor-wait cursor-pointer"
        >
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Tracing
            </span>
          ) : (
            "Trace"
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-[var(--color-edge-send)] mono tracking-wide">{error}</p>
      )}
    </form>
  );
}

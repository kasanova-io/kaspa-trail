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
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
          }}
          placeholder="kaspa:qz0m... or name.kas"
          className="flex-1 px-4 py-3 rounded-lg text-sm
            bg-[var(--color-surface)] border border-[var(--color-border)]
            text-[var(--color-text)] placeholder-[var(--color-text-muted)]
            focus:outline-none focus:border-[var(--color-accent)]
            transition-colors"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 rounded-lg text-sm font-bold
            bg-[var(--color-accent)] text-[var(--color-bg)]
            hover:opacity-90 disabled:opacity-50 transition-opacity
            cursor-pointer disabled:cursor-wait"
        >
          {loading ? "..." : "Trace"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-[var(--color-edge-send)]">{error}</p>
      )}
    </form>
  );
}

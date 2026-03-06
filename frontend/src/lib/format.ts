// ABOUTME: Shared formatting utilities for display values.
// ABOUTME: Centralizes USD formatting and protocol chip styling used across components.

export function formatUsd(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

export const PROTOCOL_CHIP_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  kas: { label: "KAS", bg: "bg-[#3366aa22]", text: "text-[#6699dd]" },
  krc20: { label: "KRC20", bg: "bg-[#ff9f1a22]", text: "text-[#ff9f1a]" },
  kns: { label: "KNS", bg: "bg-[#2ff2a822]", text: "text-[#2ff2a8]" },
  krc721: { label: "KRC721", bg: "bg-[#e6557022]", text: "text-[#e65570]" },
  kasia: { label: "Kasia", bg: "bg-[#55bbff22]", text: "text-[#55bbff]" },
  p2sh: { label: "P2SH", bg: "bg-[#8888a022]", text: "text-[#8888a0]" },
};

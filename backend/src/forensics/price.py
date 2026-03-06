# ABOUTME: Historical KAS price fetcher using CoinGecko free API.
# ABOUTME: Caches price data aggressively since historical prices are immutable.

import os

import httpx

from forensics.cache import TTLCache

COINGECKO_BASE = os.getenv("COINGECKO_API_URL", "https://api.coingecko.com/api/v3")
PRICE_CACHE_TTL = 3600.0  # 1 hour — historical prices don't change


class PriceClient:
    def __init__(self):
        self._client = httpx.AsyncClient(base_url=COINGECKO_BASE, timeout=30.0)
        self._cache = TTLCache(default_ttl=PRICE_CACHE_TTL, max_size=100)

    async def get_price_range(self, from_ts: int, to_ts: int) -> list[tuple[int, float]]:
        """Get KAS/USD prices for a time range. Returns [(timestamp_ms, price), ...]."""
        cache_key = f"price:{from_ts // 86400}:{to_ts // 86400}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            return cached

        resp = await self._client.get(
            "/coins/kaspa/market_chart/range",
            params={
                "vs_currency": "usd",
                "from": from_ts // 1000,
                "to": to_ts // 1000,
            },
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        prices = [(int(p[0]), float(p[1])) for p in data.get("prices", [])]
        self._cache.set(cache_key, prices)
        return prices

    async def get_current_price(self) -> float | None:
        """Get current KAS/USD price."""
        cached = self._cache.get("current_price")
        if cached is not None:
            return cached

        resp = await self._client.get(
            "/simple/price", params={"ids": "kaspa", "vs_currencies": "usd"}
        )
        if resp.status_code != 200:
            return None

        data = resp.json()
        price = data.get("kaspa", {}).get("usd")
        if price is not None:
            self._cache.set("current_price", price, ttl=60.0)
        return price

    async def close(self):
        await self._client.aclose()

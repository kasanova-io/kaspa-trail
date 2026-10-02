# ABOUTME: Async HTTP clients for Kaspa REST API, KNS API, and Kasplex API.
# ABOUTME: Fetches address data, transactions, known names, KNS domains, and KRC20 tokens.

import asyncio
import logging
import math
import os
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from forensics.cache import TTLCache

logger = logging.getLogger(__name__)

KASPA_API_BASE = os.getenv("KASPA_API_URL", "https://api.kaspa.org")
KNS_API_BASE = os.getenv("KNS_API_URL", "https://api.knsdomains.org/mainnet")
KASPLEX_API_BASE = os.getenv("KASPLEX_API_URL", "https://api.kasplex.org")
REQUEST_TIMEOUT = float(os.getenv("REQUEST_TIMEOUT", "30.0"))


TX_CACHE_TTL = 3600.0  # 1 hour — confirmed transactions are immutable
OPLIST_CACHE_TTL = 300.0  # 5 min — new ops may appear for active addresses
RATE_LIMIT_RETRIES = 2
MAX_RETRY_DELAY = 5.0


def retry_after_seconds(value: str | None) -> float | None:
    """Read Retry-After without shortening an upstream cooldown."""
    if not value:
        return None
    if value.isascii() and value.isdigit():
        delay = float(value)
        return delay if math.isfinite(delay) else None
    try:
        retry_at = parsedate_to_datetime(value)
        if retry_at.tzinfo is None:
            return None
        return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
    except (ValueError, TypeError, OverflowError):
        return None


class KaspaClient:
    def __init__(self, base_url: str = KASPA_API_BASE):
        self._base_url = base_url
        self._client = httpx.AsyncClient(base_url=base_url, timeout=REQUEST_TIMEOUT)
        self._tx_cache = TTLCache(default_ttl=TX_CACHE_TTL, max_size=5000)

    async def _get(self, path: str, **kwargs) -> httpx.Response:
        for attempt in range(RATE_LIMIT_RETRIES + 1):
            resp = await self._client.get(path, **kwargs)
            if resp.status_code != 429 or attempt == RATE_LIMIT_RETRIES:
                resp.raise_for_status()
                return resp
            delay = retry_after_seconds(resp.headers.get("Retry-After"))
            if delay is None:
                delay = 0.5 * 2**attempt
            if delay > MAX_RETRY_DELAY:
                # Let the caller retry later instead of holding the request open
                # or retrying before the provider's stated cooldown expires.
                resp.raise_for_status()
            await asyncio.sleep(delay)
        raise AssertionError("Unreachable retry state")

    async def get_balance(self, address: str) -> dict:
        resp = await self._get(f"/addresses/{address}/balance")
        return resp.json()

    async def get_tx_count(self, address: str) -> dict:
        resp = await self._get(f"/addresses/{address}/transactions-count")
        return resp.json()

    async def get_full_transactions(
        self,
        address: str,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        cache_key = f"txs:{address}:{limit}:{offset}"
        cached = self._tx_cache.get(cache_key)
        if cached is not None:
            return cached
        resp = await self._get(
            f"/addresses/{address}/full-transactions",
            params={
                "limit": limit,
                "offset": offset,
                "resolve_previous_outpoints": "light",
            },
        )
        result = resp.json()
        if result:
            self._tx_cache.set(cache_key, result)
        return result

    async def get_transactions_by_hash(self, tx_ids: list[str]) -> list[dict]:
        """Fetch full transaction data for specific transaction hashes.

        Uses the /transactions/search endpoint for batch retrieval.
        Results are cached individually.
        """
        uncached: list[str] = []
        results: dict[str, dict] = {}

        for tx_id in tx_ids:
            key = tx_id.lower()
            cached = self._tx_cache.get(f"tx:{key}")
            if cached is not None:
                results[key] = cached
            else:
                uncached.append(tx_id)

        if uncached:
            # Kaspa API accepts POST /transactions/search with list of tx IDs.
            # Batch in chunks of 100 to avoid 422 errors from the API.
            batch_size = 100
            for i in range(0, len(uncached), batch_size):
                batch = uncached[i : i + batch_size]
                try:
                    resp = await self._client.post(
                        "/transactions/search",
                        json={"transactionIds": batch},
                        params={"resolve_previous_outpoints": "light"},
                    )
                    resp.raise_for_status()
                    for tx in resp.json():
                        tid = tx.get("transaction_id", "")
                        if tid:
                            key = tid.lower()
                            self._tx_cache.set(f"tx:{key}", tx)
                            results[key] = tx
                except Exception:
                    logger.warning(
                        "Failed to fetch batch of %d transactions by hash",
                        len(batch),
                        exc_info=True,
                    )

        return [results[tid.lower()] for tid in tx_ids if tid.lower() in results]

    async def get_address_names(self) -> dict[str, str]:
        """Fetch all known address names. Returns {address: name} mapping."""
        resp = await self._get("/addresses/names")
        entries = resp.json()
        return {e["address"]: e["name"] for e in entries if "address" in e and "name" in e}

    async def close(self):
        await self._client.aclose()


class KnsClient:
    def __init__(self, base_url: str = KNS_API_BASE):
        self._client = httpx.AsyncClient(base_url=base_url, timeout=REQUEST_TIMEOUT)

    async def resolve_domain(self, domain: str) -> str | None:
        """Resolve a .kas domain to its owner address. Returns None if not found."""
        resp = await self._client.get(f"/api/v1/{domain}/owner")
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("success") and data.get("data"):
            return data["data"].get("owner")
        return None

    async def get_primary_name(self, address: str) -> str | None:
        """Get the primary .kas name for an address. Returns None if not set."""
        resp = await self._client.get(f"/api/v1/primary-name/{address}")
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("success") and data.get("data"):
            domain = data["data"].get("domain", {})
            return domain.get("fullName")
        return None

    async def get_primary_names_batch(self, addresses: list[str]) -> dict[str, str]:
        """Fetch primary names for multiple addresses concurrently.
        Returns {address: "name.kas"} for addresses that have primary names.
        """
        results: dict[str, str] = {}
        # Limit concurrency to avoid hammering the API
        semaphore = asyncio.Semaphore(10)

        async def fetch_one(addr: str):
            async with semaphore:
                name = await self.get_primary_name(addr)
                if name:
                    results[addr] = name

        await asyncio.gather(*(fetch_one(a) for a in addresses), return_exceptions=True)
        return results

    async def get_domains_by_owner(self, address: str) -> list[dict]:
        """Get all domains owned by an address. Returns list of {name, status}."""
        resp = await self._client.get("/api/v1/assets", params={"owner": address, "type": "domain"})
        if resp.status_code != 200:
            return []
        data = resp.json()
        if not data.get("success") or not data.get("data"):
            return []
        assets = data["data"].get("assets", [])
        return [{"name": a.get("asset", ""), "status": a.get("status", "default")} for a in assets]

    async def close(self):
        await self._client.aclose()


class KasplexClient:
    def __init__(self, base_url: str = KASPLEX_API_BASE):
        self._client = httpx.AsyncClient(base_url=base_url, timeout=REQUEST_TIMEOUT)
        self._ops_cache = TTLCache(default_ttl=OPLIST_CACHE_TTL, max_size=200)

    async def get_token_balances(self, address: str) -> list[dict]:
        """Get KRC20 token balances for an address."""
        resp = await self._client.get(f"/v1/krc20/address/{address}/tokenlist")
        if resp.status_code != 200:
            return []
        data = resp.json()
        result = data.get("result", [])
        return [
            {
                "tick": t.get("tick", ""),
                "balance": t.get("balance", "0"),
                "decimals": int(t.get("dec", "0")),
            }
            for t in result
            if int(t.get("balance", "0")) > 0
        ]

    async def get_operations(self, address: str, max_pages: int = 50) -> dict[str, str]:
        """Get KRC20 operations by address. Returns {reveal_tx_hash: "krc20:op:tick"} mapping.

        Uses cursor-based pagination to fetch all operations. The Kasplex oplist
        endpoint returns a "next" cursor for pagination.
        """
        cache_key = f"ops:{address}"
        cached = self._ops_cache.get(cache_key)
        if cached is not None:
            return cached

        ops: dict[str, str] = {}
        cursor: str | None = None

        try:
            for _ in range(max_pages):
                params: dict[str, str | int] = {"address": address, "limit": 50}
                if cursor:
                    params["next"] = cursor

                resp = await self._client.get("/v1/krc20/oplist", params=params)
                if resp.status_code != 200:
                    logger.warning(
                        "Kasplex oplist returned %d for %s", resp.status_code, address[:20]
                    )
                    break

                data = resp.json()
                results = data.get("result", []) or []

                for item in results:
                    hash_rev = item.get("hashRev", "").lower()
                    op = item.get("op", "")
                    tick = item.get("tick", "")
                    if hash_rev and op:
                        ops[hash_rev] = f"krc20:{op}" + (f":{tick}" if tick else "")

                cursor = data.get("next")
                if not cursor or not results:
                    break

            if cursor and results:
                logger.warning(
                    "Kasplex oplist truncated at %d ops for %s (max_pages=%d reached)",
                    len(ops),
                    address[:20],
                    max_pages,
                )
            else:
                logger.debug("Loaded %d KRC20 ops for %s", len(ops), address[:20])
        except Exception:
            logger.warning("Failed to fetch KRC20 ops for %s", address[:20], exc_info=True)

        if ops:
            self._ops_cache.set(cache_key, ops)
        return ops

    async def close(self):
        await self._client.aclose()

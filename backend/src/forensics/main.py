# ABOUTME: FastAPI application for Kaspa forensics API.
# ABOUTME: Exposes endpoints for address lookup, graph generation, pricing, and KNS resolution.

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from forensics.graph_builder import build_address_graph
from forensics.kaspa_client import KaspaClient, KasplexClient, KnsClient
from forensics.models import (
    AddressDetails,
    AddressGraph,
    AddressInfo,
    DomainHolding,
    PricePoint,
    TokenHolding,
)
from forensics.price import PriceClient

logger = logging.getLogger(__name__)

KASPA_ADDRESS_RE = re.compile(r"^kaspa:[a-z0-9]{61,63}$")
KNS_DOMAIN_RE = re.compile(r"^[a-z0-9\-]+\.kas$")
BATCH_SIZE = 500
DEFAULT_TX_LIMIT = 500
MAX_TX_LIMIT = 5000

client: KaspaClient
kns_client: KnsClient
kasplex_client: KasplexClient
price_client: PriceClient
address_names: dict[str, str] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, kns_client, kasplex_client, price_client, address_names
    client = KaspaClient()
    kns_client = KnsClient()
    kasplex_client = KasplexClient()
    price_client = PriceClient()
    try:
        address_names = await client.get_address_names()
        logger.info("Loaded %d address names", len(address_names))
    except Exception:
        logger.warning("Failed to load address names, continuing without them")
        address_names = {}
    yield
    await client.close()
    await kns_client.close()
    await kasplex_client.close()
    await price_client.close()


app = FastAPI(
    title="Kaspa Forensics",
    description="Address graph analysis for the Kaspa blockchain",
    version="0.2.0",
    lifespan=lifespan,
)

_cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:3001")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins.split(",")],
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _validate_address(address: str) -> None:
    if not KASPA_ADDRESS_RE.match(address):
        raise HTTPException(status_code=400, detail="Invalid Kaspa address format")


@app.get("/api/health")
async def health():
    return {"status": "ok", "known_names": len(address_names)}


class ResolveResponse(BaseModel):
    address: str
    domain: str


@app.get("/api/resolve/{domain}", response_model=ResolveResponse)
async def resolve_domain(domain: str):
    """Resolve a .kas domain to its owner address."""
    domain = domain.lower()
    if not KNS_DOMAIN_RE.match(domain):
        raise HTTPException(status_code=400, detail="Invalid KNS domain format")
    address = await kns_client.resolve_domain(domain)
    if not address:
        raise HTTPException(status_code=404, detail=f"Domain {domain} not found")
    return ResolveResponse(address=address, domain=domain)


@app.get("/api/address/{address}/info", response_model=AddressInfo)
async def get_address_info(address: str):
    _validate_address(address)
    balance_data, count_data = await asyncio.gather(
        client.get_balance(address), client.get_tx_count(address)
    )
    return AddressInfo(
        address=address,
        balance=balance_data["balance"],
        tx_count=count_data["total"],
    )


@app.get("/api/address/{address}/graph", response_model=AddressGraph)
async def get_address_graph(
    address: str,
    tx_limit: int = Query(default=DEFAULT_TX_LIMIT, ge=1, le=MAX_TX_LIMIT),
    tx_offset: int = Query(default=0, ge=0),
):
    """Build address interaction graph. Supports progressive loading via tx_limit/tx_offset."""
    _validate_address(address)
    count_data = await client.get_tx_count(address)
    tx_total = count_data["total"]

    all_transactions: list[dict] = []
    offset = tx_offset
    target = min(tx_offset + tx_limit, tx_total)

    # Fetch transactions and KRC20 operations concurrently
    krc20_ops_future = kasplex_client.get_operations(address)

    while offset < target:
        batch_size = min(BATCH_SIZE, target - offset)
        batch = await client.get_full_transactions(address, limit=batch_size, offset=offset)
        if not batch:
            break
        all_transactions.extend(batch)
        offset += len(batch)

    krc20_ops = await krc20_ops_future

    # Build P2SH address → full op mapping from reveal transactions.
    # Reveals spend FROM P2SH addresses; commits send TO them.
    # Maps P2SH address → full op value (e.g. "krc20:mint:KSNV") so commits
    # can be attributed to specific tokens and operations.
    p2sh_op: dict[str, str] = {}

    def _extract_p2sh_mappings(tx: dict) -> None:
        """Extract P2SH address → op mappings from a reveal transaction."""
        tx_id = tx.get("transaction_id", "").lower()
        op_value = krc20_ops.get(tx_id)
        if not op_value:
            return
        for inp in tx.get("inputs") or []:
            addr = inp.get("previous_outpoint_address", "")
            if addr.startswith(("kaspa:p", "kaspatest:p")):
                p2sh_op[addr] = op_value

    # Extract mapping from reveals already in the loaded set
    for tx in all_transactions:
        _extract_p2sh_mappings(tx)

    # Collect P2SH output addresses from loaded commits that still need attribution
    unmatched_p2sh: set[str] = set()
    for tx in all_transactions:
        for out in tx.get("outputs") or []:
            addr = out.get("script_public_key_address", "")
            if addr.startswith(("kaspa:p", "kaspatest:p")) and addr not in p2sh_op:
                unmatched_p2sh.add(addr)

    # Fetch missing reveals incrementally, stopping once all P2SH outputs are matched.
    if unmatched_p2sh:
        loaded_tx_ids = {tx["transaction_id"].lower() for tx in all_transactions if "transaction_id" in tx}
        missing_reveals = [tid for tid in krc20_ops if tid not in loaded_tx_ids]
        if missing_reveals:
            batch_size = 100
            for i in range(0, len(missing_reveals), batch_size):
                batch = missing_reveals[i : i + batch_size]
                reveal_txs = await client.get_transactions_by_hash(batch)
                for tx in reveal_txs:
                    _extract_p2sh_mappings(tx)
                    tx_id = tx.get("transaction_id", "").lower()
                    op_value = krc20_ops.get(tx_id)
                    if op_value:
                        for inp in tx.get("inputs") or []:
                            addr = inp.get("previous_outpoint_address", "")
                            if addr in unmatched_p2sh:
                                unmatched_p2sh.discard(addr)
                if not unmatched_p2sh:
                    break

    graph = build_address_graph(
        address,
        all_transactions,
        tx_total=tx_total,
        names=address_names,
        krc20_ops=krc20_ops,
        p2sh_op=p2sh_op,
    )

    # Enrich nodes with KNS primary names (for addresses that don't already have a name)
    unnamed_addresses = [n.id for n in graph.nodes if not n.name]
    if unnamed_addresses:
        kns_names = await kns_client.get_primary_names_batch(unnamed_addresses)
        for node in graph.nodes:
            if not node.name and node.id in kns_names:
                node.name = kns_names[node.id]
                node.label = kns_names[node.id]

    return graph


@app.get("/api/address/{address}/details", response_model=AddressDetails)
async def get_address_details(address: str):
    """Fetch detailed address info: balance, tx timestamps, KNS domains, KRC20 tokens."""
    _validate_address(address)

    # Fetch everything concurrently
    (
        balance_data,
        count_data,
        primary_name,
        domains_raw,
        tokens_raw,
    ) = await asyncio.gather(
        client.get_balance(address),
        client.get_tx_count(address),
        kns_client.get_primary_name(address),
        kns_client.get_domains_by_owner(address),
        kasplex_client.get_token_balances(address),
    )

    tx_count = count_data["total"]

    # Fetch first and last tx timestamps
    first_tx_time = None
    last_tx_time = None
    if tx_count > 0:
        first_batch, last_batch = await asyncio.gather(
            client.get_full_transactions(address, limit=1, offset=tx_count - 1),
            client.get_full_transactions(address, limit=1, offset=0),
        )
        if first_batch:
            first_tx_time = first_batch[0].get("block_time")
        if last_batch:
            last_tx_time = last_batch[0].get("block_time")

    return AddressDetails(
        address=address,
        balance=balance_data["balance"],
        tx_count=tx_count,
        first_tx_time=first_tx_time,
        last_tx_time=last_tx_time,
        primary_domain=primary_name,
        domains=[DomainHolding(name=d["name"], status=d["status"]) for d in domains_raw],
        tokens=[
            TokenHolding(tick=t["tick"], balance=t["balance"], decimals=t["decimals"])
            for t in tokens_raw
        ],
    )


@app.get("/api/price/range", response_model=list[PricePoint])
async def get_price_range(
    from_ts: int = Query(..., description="Start timestamp in unix ms"),
    to_ts: int = Query(..., description="End timestamp in unix ms"),
):
    """Get historical KAS/USD prices for a time range."""
    max_range_ms = 365 * 24 * 60 * 60 * 1000  # 1 year
    if to_ts <= from_ts or to_ts - from_ts > max_range_ms:
        raise HTTPException(status_code=400, detail="Invalid or excessive price range")
    prices = await price_client.get_price_range(from_ts, to_ts)
    return [PricePoint(timestamp=ts, price_usd=p) for ts, p in prices]


@app.get("/api/price/current")
async def get_current_price():
    """Get current KAS/USD price."""
    price = await price_client.get_current_price()
    if price is None:
        raise HTTPException(status_code=503, detail="Price unavailable")
    return {"price_usd": price}

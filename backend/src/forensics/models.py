# ABOUTME: Pydantic models for the forensics graph API.
# ABOUTME: Defines nodes, edges, graph responses, and analysis structures.

from pydantic import BaseModel, Field


class GraphNode(BaseModel):
    """A node in the address interaction graph."""

    id: str  # kaspa address
    label: str  # name if known, otherwise truncated address
    name: str | None = None  # known entity name from api.kaspa.org
    addr_type: str = "p2pk"  # "p2pk" (kaspa:q) or "p2sh" (kaspa:p)
    balance: int | None = None  # sompi, fetched on demand
    tx_count: int = 0  # number of transactions involving this address in the graph
    is_center: bool = False  # True for the searched address
    patterns: list[str] = Field(default_factory=list)


class GraphEdge(BaseModel):
    """A directed edge representing fund flow between addresses."""

    id: str  # unique edge identifier
    source: str  # sender address
    target: str  # receiver address
    total_amount: int  # total sompi transferred across all txs
    tx_count: int  # number of transactions on this edge
    tx_ids: list[str]  # transaction IDs contributing to this edge
    is_change: bool = False  # likely change output (large amount back to sender)
    first_seen: int = 0  # earliest block_time across tx_ids
    last_seen: int = 0  # latest block_time across tx_ids
    tx_types: dict[str, int] = Field(default_factory=dict)  # {"kas": 3, "krc20:transfer": 2}


class TxSummary(BaseModel):
    """Compact transaction summary for the tx list panel."""

    tx_id: str
    block_time: int  # unix ms
    inputs: list[str]  # input addresses
    outputs: list[str]  # output addresses
    amounts: list[int]  # output amounts (parallel with outputs)
    tx_type: str = "kas"  # "kas", "krc20:mint", "krc20:transfer", "kns:create", etc.


class AddressGraph(BaseModel):
    """The full graph response for an address lookup."""

    center: str  # the queried address
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    transactions: list[TxSummary]
    tx_total: int  # total transactions for the center address
    tx_loaded: int = 0  # how many transactions were actually fetched
    krc20_tokens: list[str] = Field(default_factory=list)  # unique KRC20 tickers from oplist


class AddressInfo(BaseModel):
    """Basic address information."""

    address: str
    balance: int  # sompi
    tx_count: int


class TokenHolding(BaseModel):
    tick: str
    balance: str
    decimals: int


class DomainHolding(BaseModel):
    name: str
    status: str  # "default" or "listed"


class AddressDetails(BaseModel):
    """Full address details for the inspect panel."""

    address: str
    balance: int  # sompi
    tx_count: int
    first_tx_time: int | None = None  # unix ms
    last_tx_time: int | None = None  # unix ms
    primary_domain: str | None = None  # KNS primary .kas name
    domains: list[DomainHolding] = Field(default_factory=list)
    tokens: list[TokenHolding] = Field(default_factory=list)


class PricePoint(BaseModel):
    timestamp: int  # unix ms
    price_usd: float

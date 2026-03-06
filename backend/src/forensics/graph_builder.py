# ABOUTME: Transforms raw Kaspa transaction data into an address interaction graph.
# ABOUTME: Extracts nodes (addresses) and edges (fund flows) with pattern detection.

from collections import defaultdict
from typing import Any

from forensics.models import AddressGraph, GraphEdge, GraphNode, TxSummary

DUST_THRESHOLD = 100_000  # 0.001 KAS in sompi
SOMPI_PER_KAS = 100_000_000

# Protocol markers found after OP_FALSE OP_IF in P2SH redeem scripts
SCRIPT_PROTOCOL_MARKERS: dict[bytes, str] = {
    b"kasplex": "krc20",
    b"kns": "kns",
    b"krc721": "krc721",
    b"kspr": "krc721",
}

# Kasia encrypted message payload prefix
KASIA_PREFIX_HEX = bytes("ciph_msg:1:", "utf-8").hex()


def _truncate_address(address: str) -> str:
    """Truncate a kaspa address for display: keep prefix + first 4 chars ... last 4 chars."""
    prefix, _, payload = address.partition(":")
    if len(payload) <= 12:
        return address
    return f"{prefix}:{payload[:4]}...{payload[-4:]}"


def _detect_addr_type(address: str) -> str:
    """Detect address type from prefix. kaspa:q = P2PK, kaspa:p = P2SH."""
    _, _, payload = address.partition(":")
    if payload.startswith("p"):
        return "p2sh"
    return "p2pk"


def _is_round_amount(sompi: int) -> bool:
    """Check if amount is a round number of KAS (no fractional sompi)."""
    return sompi > 0 and sompi % SOMPI_PER_KAS == 0


def _detect_tx_patterns(
    tx: dict,
    input_addresses: set[str],
    output_addresses: list[str],
    output_amounts: list[int],
) -> dict[str, set[str]]:
    """Detect patterns in a single transaction. Returns {pattern: set of addresses}."""
    patterns: dict[str, set[str]] = defaultdict(set)

    n_inputs = len(input_addresses)
    n_outputs = len(output_addresses)

    # Fan-out: 1 input address, 5+ output addresses
    if n_inputs == 1 and n_outputs >= 5:
        for addr in input_addresses:
            patterns["fan_out"].add(addr)

    # Fan-in: 5+ input addresses, 1-2 output addresses
    if n_inputs >= 5 and n_outputs <= 2:
        for addr in output_addresses:
            patterns["fan_in"].add(addr)

    # Peel chain: 1 input address, exactly 2 outputs, one output is >90% of total
    if n_inputs == 1 and n_outputs == 2:
        total = sum(output_amounts)
        if total > 0:
            ratio = max(output_amounts) / total
            if ratio > 0.9:
                for addr in input_addresses:
                    patterns["peel_chain"].add(addr)

    # Dust outputs
    for addr, amt in zip(output_addresses, output_amounts):
        if 0 < amt < DUST_THRESHOLD:
            patterns["dust"].add(addr)

    return patterns


def _detect_protocol_from_script(tx: dict) -> str | None:
    """Detect protocol from P2SH input signature scripts.

    Looks for OP_FALSE OP_IF (0x00 0x63) followed by a known protocol marker
    in the redeem script of P2SH inputs. This is how inscription reveals work.
    """
    for inp in tx.get("inputs", []):
        prev_addr = inp.get("previous_outpoint_address", "")
        if not prev_addr.startswith(("kaspa:p", "kaspatest:p")):
            continue
        sig_script = inp.get("signature_script", "")
        if not sig_script:
            continue
        try:
            script_bytes = bytes.fromhex(sig_script)
            idx = script_bytes.find(b"\x00\x63")  # OP_FALSE OP_IF
            if idx < 0:
                continue
            remainder = script_bytes[idx:]
            for marker, protocol in SCRIPT_PROTOCOL_MARKERS.items():
                if marker in remainder:
                    return protocol
        except (ValueError, IndexError):
            continue
    return None


def _detect_kasia_from_payload(tx: dict) -> bool:
    """Detect Kasia messaging transactions from the transaction payload field."""
    payload = tx.get("payload", "")
    return bool(payload and payload.startswith(KASIA_PREFIX_HEX))


def _classify_tx_type(
    tx: dict,
    tx_id: str,
    input_addresses: set[str],
    output_addresses: list[str],
    output_amounts: list[int],
    krc20_ops: dict[str, str],
) -> str:
    """Classify a transaction by protocol type.

    Priority: KRC20 oplist > script detection > Kasia payload > fee heuristics.
    """
    # 1. Check KRC20 oplist first (exact match by reveal tx hash)
    tx_id_lower = tx_id.lower()
    if tx_id_lower in krc20_ops:
        return krc20_ops[tx_id_lower]

    # 2. Script-based detection from P2SH inputs (reveals)
    script_protocol = _detect_protocol_from_script(tx)
    if script_protocol == "krc721":
        return "krc721:transfer"
    if script_protocol == "kns":
        return "kns:reveal"
    if script_protocol == "krc20":
        # KRC20 reveal not in oplist — classify generically
        return "krc20:unknown"

    # 3. Kasia payload detection
    if _detect_kasia_from_payload(tx):
        return "kasia:message"

    # 4. Check for P2SH outputs (inscription commits)
    p2sh_outputs = [
        (addr, amt)
        for addr, amt in zip(output_addresses, output_amounts)
        if addr.startswith(("kaspa:p", "kaspatest:p"))
    ]

    if not p2sh_outputs:
        has_p2sh_input = any(
            a.startswith(("kaspa:p", "kaspatest:p")) for a in input_addresses
        )
        if has_p2sh_input:
            # P2SH reveal without script data — can't determine protocol
            return "p2sh:reveal"
        return "kas"

    # 5. Fee-based heuristics for P2SH commits
    kns_fees = {
        4200 * SOMPI_PER_KAS,
        2100 * SOMPI_PER_KAS,
        525 * SOMPI_PER_KAS,
        35 * SOMPI_PER_KAS,
    }

    for _addr, amt in p2sh_outputs:
        if amt in kns_fees:
            return "kns:create"

    for _addr, amt in p2sh_outputs:
        if amt == 1000 * SOMPI_PER_KAS:
            return "krc20:deploy"
        if amt == 1 * SOMPI_PER_KAS:
            return "krc20:mint"

    # P2SH output with unrecognized fee — could be KRC721 mint (custom royalty)
    return "p2sh:commit"


def build_address_graph(
    center: str,
    transactions: list[dict[str, Any]],
    tx_total: int,
    names: dict[str, str] | None = None,
    krc20_ops: dict[str, str] | None = None,
) -> AddressGraph:
    """Build an address interaction graph from raw transaction data.

    For each accepted transaction, creates directed edges from every input address
    to every output address, weighted by the output amount.
    """
    krc20_ops = krc20_ops or {}

    edge_map: dict[tuple[str, str], dict] = defaultdict(
        lambda: {
            "total_amount": 0,
            "tx_count": 0,
            "tx_ids": [],
            "block_times": [],
            "tx_types": defaultdict(int),
        }
    )
    node_tx_counts: dict[str, int] = defaultdict(int)
    node_net_flow: dict[str, int] = defaultdict(int)
    node_patterns: dict[str, set[str]] = defaultdict(set)
    tx_summaries: list[TxSummary] = []

    for tx in transactions:
        if not tx.get("is_accepted", False):
            continue

        tx_id = tx["transaction_id"]
        block_time = tx.get("block_time", 0)
        input_addresses = set()
        for inp in tx.get("inputs") or []:
            addr = inp.get("previous_outpoint_address")
            if addr:
                input_addresses.add(addr)

        output_addresses: list[str] = []
        output_amounts: list[int] = []
        for out in tx.get("outputs", []):
            out_addr = out.get("script_public_key_address")
            out_amount = out.get("amount", 0)
            if not out_addr:
                continue
            output_addresses.append(out_addr)
            output_amounts.append(out_amount)

        tx_type = _classify_tx_type(
            tx, tx_id, input_addresses, output_addresses, output_amounts, krc20_ops
        )

        # Build edges with type info
        for out_addr, out_amount in zip(output_addresses, output_amounts):
            for in_addr in input_addresses:
                key = (in_addr, out_addr)
                edge_map[key]["total_amount"] += out_amount
                edge_map[key]["block_times"].append(block_time)
                if tx_id not in edge_map[key]["tx_ids"]:
                    edge_map[key]["tx_ids"].append(tx_id)
                    edge_map[key]["tx_count"] += 1
                # Normalize tx_type base for edge aggregation (strip ticker)
                base_type = ":".join(tx_type.split(":")[:2])
                edge_map[key]["tx_types"][base_type] += 1

        tx_summaries.append(
            TxSummary(
                tx_id=tx_id,
                block_time=block_time,
                inputs=sorted(input_addresses),
                outputs=output_addresses,
                amounts=output_amounts,
                tx_type=tx_type,
            )
        )

        for addr in input_addresses:
            node_tx_counts[addr] += 1
        for out_addr, out_amount in zip(output_addresses, output_amounts):
            node_tx_counts[out_addr] += 1
            node_net_flow[out_addr] += out_amount
        # Approximate input spend: total outputs / number of input addresses
        total_out = sum(output_amounts)
        if input_addresses:
            per_input = total_out // len(input_addresses)
            for addr in input_addresses:
                node_net_flow[addr] -= per_input

        # Detect patterns
        tx_patterns = _detect_tx_patterns(tx, input_addresses, output_addresses, output_amounts)
        for pattern, addrs in tx_patterns.items():
            for addr in addrs:
                node_patterns[addr].add(pattern)

    all_addresses = set(node_tx_counts.keys())
    all_addresses.add(center)

    names = names or {}
    nodes = []
    for addr in all_addresses:
        name = names.get(addr)
        nodes.append(
            GraphNode(
                id=addr,
                label=name if name else _truncate_address(addr),
                name=name,
                addr_type=_detect_addr_type(addr),
                balance=max(0, node_net_flow.get(addr, 0)),
                tx_count=node_tx_counts.get(addr, 0),
                is_center=(addr == center),
                patterns=sorted(node_patterns.get(addr, set())),
            )
        )

    edges = []
    for (source, target), data in edge_map.items():
        block_times = data["block_times"]
        is_change = source == target
        edges.append(
            GraphEdge(
                id=f"{source}->{target}",
                source=source,
                target=target,
                total_amount=data["total_amount"],
                tx_count=data["tx_count"],
                tx_ids=data["tx_ids"],
                is_change=is_change,
                first_seen=min(block_times) if block_times else 0,
                last_seen=max(block_times) if block_times else 0,
                tx_types=dict(data["tx_types"]),
            )
        )

    tx_summaries.sort(key=lambda t: t.block_time, reverse=True)

    return AddressGraph(
        center=center,
        nodes=nodes,
        edges=edges,
        transactions=tx_summaries,
        tx_total=tx_total,
        tx_loaded=len(tx_summaries),
    )

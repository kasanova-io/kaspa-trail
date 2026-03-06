# ABOUTME: Tests for the graph builder that transforms Kaspa transactions into address graphs.
# ABOUTME: Uses real API response shapes from api.kaspa.org.

from forensics.graph_builder import build_address_graph
from forensics.models import AddressGraph

CENTER = "kaspa:qpz2vgvlxhmyhmt22h538pjzmvvd52nuut80y5zulgpvyerlskvvwm7n4uk5a"

SAMPLE_TXS = [
    {
        "transaction_id": "6b2fc21608f05a3bb3d3dbaa1e77bbb43270c6999dadcdd83d332b441e1418aa",
        "block_time": 1772695355549,
        "is_accepted": True,
        "inputs": [
            {
                "previous_outpoint_address": "kaspa:qqftm2326a5kyxahxnxkvtvqggptg64zwcv3e0dsang3xf9e25rx2hjnrptrf",
                "previous_outpoint_amount": 47872038691,
            },
            {
                "previous_outpoint_address": "kaspa:qqftm2326a5kyxahxnxkvtvqggptg64zwcv3e0dsang3xf9e25rx2hjnrptrf",
                "previous_outpoint_amount": 33987912010,
            },
        ],
        "outputs": [
            {
                "amount": 100000000,
                "script_public_key_address": CENTER,
            },
            {
                "amount": 81759930701,
                "script_public_key_address": "kaspa:qp2kfwg2zdke5xyycp860wenh5xzr9tnzvrzt43rhr6xdg87xkcr6xet77kng",
            },
        ],
    },
    {
        "transaction_id": "aee15070655fb622b6cd59fc060b2a136688ad535e9579485325a45f0bb14647",
        "block_time": 1772182692214,
        "is_accepted": True,
        "inputs": [
            {
                "previous_outpoint_address": "kaspa:qr4nw9v5kay7cjgpe4h7rh28fy5f7x87s53drl85pmdultawn6e82pppx3tal",
                "previous_outpoint_amount": 1169892727,
            },
            {
                "previous_outpoint_address": "kaspa:qr4nw9v5kay7cjgpe4h7rh28fy5f7x87s53drl85pmdultawn6e82pppx3tal",
                "previous_outpoint_amount": 233122974,
            },
        ],
        "outputs": [
            {
                "amount": 20001000,
                "script_public_key_address": CENTER,
            },
            {
                "amount": 1382966831,
                "script_public_key_address": "kaspa:qr4nw9v5kay7cjgpe4h7rh28fy5f7x87s53drl85pmdultawn6e82pppx3tal",
            },
        ],
    },
]


def test_build_graph_returns_address_graph():
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    assert isinstance(graph, AddressGraph)
    assert graph.center == CENTER
    assert graph.tx_total == 384


def test_build_graph_creates_correct_nodes():
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    addresses = {n.id for n in graph.nodes}
    assert CENTER in addresses
    assert "kaspa:qqftm2326a5kyxahxnxkvtvqggptg64zwcv3e0dsang3xf9e25rx2hjnrptrf" in addresses
    assert "kaspa:qr4nw9v5kay7cjgpe4h7rh28fy5f7x87s53drl85pmdultawn6e82pppx3tal" in addresses
    assert "kaspa:qp2kfwg2zdke5xyycp860wenh5xzr9tnzvrzt43rhr6xdg87xkcr6xet77kng" in addresses


def test_center_node_is_marked():
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    center_node = next(n for n in graph.nodes if n.id == CENTER)
    assert center_node.is_center is True
    other_nodes = [n for n in graph.nodes if n.id != CENTER]
    assert all(not n.is_center for n in other_nodes)


def test_build_graph_creates_directed_edges():
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    # TX1: qqftm... → CENTER (100000000 sompi)
    edge_to_center = next(
        (
            e
            for e in graph.edges
            if e.source == "kaspa:qqftm2326a5kyxahxnxkvtvqggptg64zwcv3e0dsang3xf9e25rx2hjnrptrf"
            and e.target == CENTER
        ),
        None,
    )
    assert edge_to_center is not None
    assert edge_to_center.total_amount == 100000000
    assert edge_to_center.tx_count == 1


def test_build_graph_aggregates_edges():
    """Two txs from same sender to same receiver should aggregate."""
    txs = [
        {
            "transaction_id": "tx1",
            "block_time": 1000,
            "is_accepted": True,
            "inputs": [
                {
                    "previous_outpoint_address": "kaspa:sender1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "previous_outpoint_amount": 500,
                },
            ],
            "outputs": [
                {"amount": 100, "script_public_key_address": CENTER},
                {
                    "amount": 400,
                    "script_public_key_address": "kaspa:sender1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                },
            ],
        },
        {
            "transaction_id": "tx2",
            "block_time": 2000,
            "is_accepted": True,
            "inputs": [
                {
                    "previous_outpoint_address": "kaspa:sender1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "previous_outpoint_amount": 300,
                },
            ],
            "outputs": [
                {"amount": 200, "script_public_key_address": CENTER},
                {
                    "amount": 100,
                    "script_public_key_address": "kaspa:sender1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                },
            ],
        },
    ]
    graph = build_address_graph(CENTER, txs, tx_total=2)
    edge = next(
        e
        for e in graph.edges
        if e.source == "kaspa:sender1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        and e.target == CENTER
    )
    assert edge.total_amount == 300  # 100 + 200
    assert edge.tx_count == 2
    assert set(edge.tx_ids) == {"tx1", "tx2"}


def test_build_graph_handles_self_transfer():
    """Change outputs (same address in inputs and outputs) create self-edges."""
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    # TX2: qr4nw... appears in both inputs and outputs (change)
    self_edge = next(
        (
            e
            for e in graph.edges
            if e.source == "kaspa:qr4nw9v5kay7cjgpe4h7rh28fy5f7x87s53drl85pmdultawn6e82pppx3tal"
            and e.target == "kaspa:qr4nw9v5kay7cjgpe4h7rh28fy5f7x87s53drl85pmdultawn6e82pppx3tal"
        ),
        None,
    )
    assert self_edge is not None
    assert self_edge.total_amount == 1382966831


def test_build_graph_empty_transactions():
    graph = build_address_graph(CENTER, [], tx_total=0)
    assert len(graph.nodes) == 1
    assert graph.nodes[0].id == CENTER
    assert graph.nodes[0].is_center is True
    assert len(graph.edges) == 0


def test_node_label_is_truncated():
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    center_node = next(n for n in graph.nodes if n.id == CENTER)
    assert len(center_node.label) < len(CENTER)
    assert center_node.label.startswith("kaspa:qpz2")
    assert center_node.label.endswith("uk5a")


def test_p2pk_address_type():
    graph = build_address_graph(CENTER, SAMPLE_TXS, tx_total=384)
    center_node = next(n for n in graph.nodes if n.id == CENTER)
    assert center_node.addr_type == "p2pk"
    # All sample addresses start with kaspa:q
    assert all(n.addr_type == "p2pk" for n in graph.nodes)


def test_p2sh_address_type():
    p2sh_addr = "kaspa:precqv0krj3r6uyyfa36ga7s0u9jct0v4wg8ctsfde2gkrsgwgw8jgxfzfc98"
    txs = [
        {
            "transaction_id": "tx_p2sh",
            "block_time": 1000,
            "is_accepted": True,
            "inputs": [
                {"previous_outpoint_address": CENTER, "previous_outpoint_amount": 5000},
            ],
            "outputs": [
                {"amount": 4000, "script_public_key_address": p2sh_addr},
                {"amount": 1000, "script_public_key_address": CENTER},
            ],
        },
    ]
    graph = build_address_graph(CENTER, txs, tx_total=1)
    p2sh_node = next(n for n in graph.nodes if n.id == p2sh_addr)
    assert p2sh_node.addr_type == "p2sh"
    center_node = next(n for n in graph.nodes if n.id == CENTER)
    assert center_node.addr_type == "p2pk"


def test_skips_unaccepted_transactions():
    txs = [
        {
            "transaction_id": "tx_rejected",
            "block_time": 1000,
            "is_accepted": False,
            "inputs": [
                {
                    "previous_outpoint_address": "kaspa:sender1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "previous_outpoint_amount": 500,
                },
            ],
            "outputs": [
                {"amount": 500, "script_public_key_address": CENTER},
            ],
        },
    ]
    graph = build_address_graph(CENTER, txs, tx_total=1)
    assert len(graph.edges) == 0
    assert len(graph.nodes) == 1

"""Exercise real clients and API routes with controlled upstream HTTP responses."""

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from forensics import main
from forensics.kaspa_client import KaspaClient, KasplexClient, KnsClient, retry_after_seconds

ADDRESS = "kaspa:qq3jlzhdke9vrelzlp2pjhy7pgfqnqj4290j5mex9sxpxg08pc60vaz7z6lds"
API = "https://kaspa.test"
COUNT_URL = f"{API}/addresses/{ADDRESS}/transactions-count"


@pytest.fixture
async def clients(monkeypatch):
    kaspa = KaspaClient(API)
    kns = KnsClient("https://kns.test")
    kasplex = KasplexClient("https://kasplex.test")
    monkeypatch.setattr(main, "client", kaspa, raising=False)
    monkeypatch.setattr(main, "kns_client", kns, raising=False)
    monkeypatch.setattr(main, "kasplex_client", kasplex, raising=False)
    yield kaspa
    await kaspa.close()
    await kns.close()
    await kasplex.close()


@pytest.fixture
def sleep(monkeypatch):
    sleep = AsyncMock()
    monkeypatch.setattr("forensics.kaspa_client.asyncio.sleep", sleep)
    return sleep


async def get_route(path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=main.app), base_url="http://forensics.test"
    ) as client:
        return await client.get(path)


async def test_new_address_graph_recovers_from_rate_limit(clients, httpx_mock, sleep):
    httpx_mock.add_response(url=COUNT_URL, status_code=429, headers={"Retry-After": "1"})
    httpx_mock.add_response(url=COUNT_URL, json={"total": 0})
    httpx_mock.add_response(
        url=f"https://kasplex.test/v1/krc20/oplist?address={ADDRESS}&limit=50",
        json={"result": []},
    )
    httpx_mock.add_response(url=f"https://kns.test/api/v1/primary-name/{ADDRESS}", status_code=404)

    response = await get_route(f"/api/address/{ADDRESS}/graph?tx_limit=100")

    assert response.status_code == 200
    graph = response.json()
    assert graph["center"] == ADDRESS
    assert graph["tx_total"] == graph["tx_loaded"] == 0
    assert graph["transactions"] == graph["edges"] == []
    assert len(graph["nodes"]) == 1
    assert graph["nodes"][0]["id"] == ADDRESS
    sleep.assert_awaited_once_with(1.0)


async def test_persistent_rate_limit_is_visible_not_empty_graph(clients, httpx_mock, sleep):
    for _ in range(3):
        httpx_mock.add_response(url=COUNT_URL, status_code=429)

    response = await get_route(f"/api/address/{ADDRESS}/graph")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "30"
    assert "rate limiting" in response.json()["detail"]
    assert "tx_total" not in response.json()
    assert [call.args[0] for call in sleep.await_args_list] == [0.5, 1.0]


async def test_long_cooldown_is_not_retried_early(clients, httpx_mock, sleep):
    httpx_mock.add_response(url=COUNT_URL, status_code=429, headers={"Retry-After": "120"})

    response = await get_route(f"/api/address/{ADDRESS}/graph")

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "120"
    assert "120 seconds" in response.json()["detail"]
    sleep.assert_not_awaited()


@pytest.mark.parametrize("status", [404, 500, 502])
async def test_other_upstream_errors_are_not_retried_or_treated_as_empty(
    clients, httpx_mock, sleep, status
):
    httpx_mock.add_response(url=COUNT_URL, status_code=status, text="private upstream error")

    response = await get_route(f"/api/address/{ADDRESS}/graph")

    assert response.status_code == 503
    assert "temporarily unavailable" in response.json()["detail"]
    assert "private upstream error" not in response.text
    sleep.assert_not_awaited()


@pytest.mark.parametrize("error,status", [(httpx.ReadTimeout, 504), (httpx.ConnectError, 503)])
async def test_transport_errors_have_readable_json(clients, httpx_mock, error, status):
    httpx_mock.add_exception(error("upstream failure"), url=COUNT_URL)

    response = await get_route(f"/api/address/{ADDRESS}/graph")

    assert response.status_code == status
    assert "Could not reach" in response.json()["detail"]


@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("get_balance", f"/addresses/{ADDRESS}/balance", {"balance": 0}),
        ("get_tx_count", f"/addresses/{ADDRESS}/transactions-count", {"total": 0}),
        (
            "get_full_transactions",
            f"/addresses/{ADDRESS}/full-transactions?limit=50&offset=0&resolve_previous_outpoints=light",
            [],
        ),
    ],
)
async def test_address_reads_share_retry_handling(
    clients, httpx_mock, sleep, method, path, payload
):
    httpx_mock.add_response(url=API + path, status_code=429, headers={"Retry-After": "invalid"})
    httpx_mock.add_response(url=API + path, json=payload)

    assert await getattr(clients, method)(ADDRESS) == payload
    sleep.assert_awaited_once_with(0.5)


async def test_transaction_page_failure_does_not_leave_unawaited_enrichment(clients, httpx_mock):
    httpx_mock.add_response(url=COUNT_URL, json={"total": 1})
    httpx_mock.add_response(
        url=f"{API}/addresses/{ADDRESS}/full-transactions?limit=1&offset=0&resolve_previous_outpoints=light",
        status_code=429,
        headers={"Retry-After": "60"},
    )

    response = await get_route(f"/api/address/{ADDRESS}/graph")

    assert response.status_code == 503
    assert "60 seconds" in response.json()["detail"]


def test_retry_after_http_date():
    value = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=120), usegmt=True)
    assert 118 <= retry_after_seconds(value) <= 120


@pytest.mark.parametrize("value", [None, "", "garbage", "-1", "NaN", "inf", "9" * 400])
def test_invalid_retry_after_uses_fallback(value):
    assert retry_after_seconds(value) is None

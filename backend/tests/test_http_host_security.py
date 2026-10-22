"""Keep untrusted Host values from changing the path used by HTTP guards."""

import pytest
from starlette.requests import Request


@pytest.mark.parametrize(
    "host",
    ["api.example.test", "api.example.test:443", "api.example.test/public?", "api.example.test/#"],
)
def test_request_url_preserves_routed_path(host):
    scope = {
        "type": "http",
        "scheme": "https",
        "server": ("api.example.test", 443),
        "path": "/api/address/example/graph",
        "query_string": b"",
        "headers": [(b"host", host.encode("ascii"))],
    }

    assert Request(scope).url.path == scope["path"]

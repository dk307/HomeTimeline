"""Integration tests — CORS policy regression guard.

The API currently allows all origins (allow_origins=["*"]).  This test
documents that behaviour so any future tightening is caught immediately.
"""


def test_cors_wildcard_origin(client):
    """Requests from any origin receive Access-Control-Allow-Origin: *."""
    r = client.get(
        "/api/v1/health",
        headers={"Origin": "http://evil.example.com"},
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"


def test_cors_preflight(client):
    """OPTIONS pre-flight for a cross-origin POST is accepted."""
    r = client.options(
        "/api/v1/locations/",
        headers={
            "Origin": "http://other.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    # FastAPI/Starlette returns 200 for pre-flight when all origins are allowed
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == "*"

"""
JWT Bearer token authentication for MCP streamable HTTP connections.
Used when the AgentCore Gateway is configured with JWT (OIDC) authorizer.
"""

from contextlib import asynccontextmanager

import httpx
from mcp.client.streamable_http import streamablehttp_client


class JWTBearerAuth(httpx.Auth):
    """HTTPX Auth class that adds Bearer token to requests."""

    def __init__(self, token: str):
        self.token = token

    def auth_flow(self, request: httpx.Request):
        request.headers["Authorization"] = f"Bearer {self.token}"
        yield request


@asynccontextmanager
async def streamablehttp_client_with_jwt(
    url: str,
    jwt_token: str,
    timeout: float = 30.0,
):
    """Create a streamable HTTP MCP client with JWT Bearer authentication."""
    auth = JWTBearerAuth(jwt_token)
    async with streamablehttp_client(url, auth=auth, timeout=timeout) as client:
        yield client

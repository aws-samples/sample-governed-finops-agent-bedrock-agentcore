"""
AgentCore Cost Optimizer - Recommender Agent Runtime

Strands Agent on Amazon Bedrock AgentCore with MCP Gateway integration.
Uses JWT Bearer token for Gateway authentication (propagates user identity).
"""

import logging
import os
import time
from typing import Any, cast

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from mcp_transport import streamablehttp_client_with_jwt
from prompt import build_system_prompt
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# AgentCore app
app = BedrockAgentCoreApp()

# Configuration from environment
GATEWAY_ARN = os.environ.get("GATEWAY_ARN")
MEMORY_ID = os.environ.get("MEMORY_ID")
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
PHASE = int(os.environ.get("PHASE", "1"))
REMEDIATOR_GATEWAY_ARN = os.environ.get("REMEDIATOR_GATEWAY_ARN", "")

logger.info("Gateway ARN: %s", GATEWAY_ARN)
logger.info("Remediator Gateway ARN: %s", REMEDIATOR_GATEWAY_ARN)
logger.info("Model: %s | Memory: %s | Phase: %d", MODEL_ID, MEMORY_ID, PHASE)

# Bedrock model
model = BedrockModel(model_id=MODEL_ID, region_name=AWS_REGION)

# Gateway endpoint (Billing/Pricing)
gateway_id = GATEWAY_ARN.split("/")[-1] if GATEWAY_ARN else None
gateway_endpoint = (
    f"https://{gateway_id}.gateway.bedrock-agentcore.{AWS_REGION}.amazonaws.com/mcp" if gateway_id else None
)

# Remediator Gateway endpoint (derived from ARN, same pattern as billing gateway)
remediator_gw_id = REMEDIATOR_GATEWAY_ARN.split("/")[-1] if REMEDIATOR_GATEWAY_ARN else None
REMEDIATOR_GATEWAY_URL = (
    f"https://{remediator_gw_id}.gateway.bedrock-agentcore.{AWS_REGION}.amazonaws.com/mcp" if remediator_gw_id else ""
)
logger.info("Remediator Gateway URL (derived): %s", REMEDIATOR_GATEWAY_URL)

# ========================================
# Remediator Gateway tools/list cache
# ========================================
_remediator_actions_cache: dict[str, Any] = {"actions": None, "fetched_at": 0}
_CACHE_TTL_SECONDS = 300  # 5 minutes


class RemediatorDiscoveryError(Exception):
    """Raised when the Remediator Gateway cannot list available tools."""

    pass


def fetch_remediator_actions(jwt_token: str) -> list[str]:
    """Fetch available actions from the Remediator Gateway via MCP tools/list.

    The Remediator Gateway is an MCP Gateway with Lambda targets. Each target
    exposes tools via the MCP protocol (tools/list). We connect using the same
    JWT-authenticated streamable HTTP transport used for the Billing Gateway.

    Returns a list of tool names (e.g., ['resize_instance', 'stop_instance', ...]).
    Results are cached for 5 minutes to avoid repeated calls.

    Raises RemediatorDiscoveryError if tools cannot be listed (no fallback).
    """
    global _remediator_actions_cache

    # Check cache first
    now = time.time()
    cached_actions = _remediator_actions_cache["actions"]
    cached_time = _remediator_actions_cache["fetched_at"]
    if (
        cached_actions is not None
        and isinstance(cached_time, (int, float))
        and (now - cached_time) < _CACHE_TTL_SECONDS
    ):
        actions_list = cast(list[str], cached_actions)
        logger.info("Using cached remediator actions (%d actions)", len(actions_list))
        return actions_list

    if not REMEDIATOR_GATEWAY_URL:
        raise RemediatorDiscoveryError("REMEDIATOR_GATEWAY_URL not configured. Cannot discover remediation actions.")

    if not jwt_token:
        raise RemediatorDiscoveryError("No JWT token available. Cannot authenticate to Remediator Gateway.")

    # Attempt MCP tools/list with 1 retry
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            logger.info(
                "Connecting to Remediator Gateway MCP (attempt %d/2): %s",
                attempt + 1,
                REMEDIATOR_GATEWAY_URL,
            )
            mcp_client = MCPClient(
                lambda: streamablehttp_client_with_jwt(
                    url=REMEDIATOR_GATEWAY_URL,
                    jwt_token=jwt_token,
                    timeout=15.0,
                )
            )
            mcp_client.__enter__()
            try:
                tools = mcp_client.list_tools_sync()
                actions = []
                if tools:
                    for t in tools:
                        # MCPAgentTool objects use .tool_name, not .name
                        tool_name = t.tool_name if hasattr(t, "tool_name") else getattr(t, "name", str(t))
                        # Format is "targetName___toolName" -> extract toolName
                        if "___" in tool_name:
                            action_name = tool_name.split("___", 1)[1]
                        else:
                            action_name = tool_name
                        actions.append(action_name)
                logger.info(
                    "Fetched %d actions from Remediator Gateway via MCP: %s",
                    len(actions),
                    actions,
                )

                if actions:
                    _remediator_actions_cache["actions"] = actions
                    _remediator_actions_cache["fetched_at"] = now
                    return actions
                else:
                    last_error = RemediatorDiscoveryError(
                        "MCP tools/list returned 0 tools. "
                        "Possible causes: JWT auth rejected, Gateway targets not ready, "
                        "or Cedar policies blocking tool listing."
                    )
                    logger.warning("Attempt %d: tools/list returned empty", attempt + 1)
            finally:
                try:
                    mcp_client.__exit__(None, None, None)
                except Exception:
                    pass

        except RemediatorDiscoveryError:
            raise
        except Exception as e:
            last_error = e
            logger.warning(
                "Attempt %d failed to connect to Remediator Gateway MCP: %s",
                attempt + 1,
                e,
            )

        # Brief delay before retry
        if attempt == 0:
            time.sleep(2)

    # Both attempts failed
    error_msg = f"Failed to list remediation tools from Gateway ({REMEDIATOR_GATEWAY_URL}). Last error: {last_error}"
    logger.error(error_msg)
    raise RemediatorDiscoveryError(error_msg)


# Phase 4: Learning Engine
learning_engine = None
if PHASE >= 4:
    try:
        from tools.learning import LearningEngine

        learning_engine = LearningEngine(memory_id=MEMORY_ID, region=AWS_REGION)
        logger.info("Learning Engine initialized (Phase 4)")
    except Exception as e:
        logger.warning("Learning Engine unavailable: %s", e)


def _build_learning_tools():
    """Build Strands-compatible tool functions for the Learning Engine."""
    if not learning_engine:
        return []

    from strands import tool

    @tool
    def record_feedback(
        user_id: str,
        recommendation_id: str,
        category: str,
        accepted: bool,
        reason: str = "",
    ) -> dict[str, Any]:
        """Record user feedback (accept/reject) for a recommendation.

        Args:
            user_id: The user providing feedback.
            recommendation_id: ID of the recommendation.
            category: Category of the recommendation (rightsizing, idle_resources, etc).
            accepted: True if user accepted, False if rejected.
            reason: Optional reason for the feedback.
        """
        result = learning_engine.record_feedback(
            user_id=user_id,
            recommendation_id=recommendation_id,
            category=category,
            accepted=accepted,
            reason=reason or None,
        )
        return cast(dict[str, Any], result)

    @tool
    def get_user_preferences(user_id: str) -> dict[str, Any]:
        """Get learned preferences for a user based on their feedback history.

        Args:
            user_id: The user to get preferences for.

        Returns a dict with accepted/rejected counts per category,
        risk tolerance, and preferred savings threshold.
        """
        prefs = learning_engine.get_user_preferences(user_id)
        return {
            "user_id": prefs.user_id,
            "accepted_categories": prefs.accepted_categories,
            "rejected_categories": prefs.rejected_categories,
            "risk_tolerance": prefs.risk_tolerance,
            "preferred_savings_threshold": prefs.preferred_savings_threshold,
            "last_updated": prefs.last_updated,
        }

    return [record_feedback, get_user_preferences]


def create_agent_with_jwt(jwt_token: str):
    """Create an agent with MCP tools using JWT Bearer auth for the Gateway.

    Each request gets a fresh MCP connection with the user's JWT token,
    so the Gateway knows who the user is (for Cedar policy evaluation).
    Phase 4: Also includes learning tools (record_feedback, get_user_preferences).

    Returns: (mcp_client_or_None, tools_list, error_message)
    The caller MUST keep mcp_client alive while using the tools.
    """
    # Collect Phase 4 learning tools
    extra_tools = _build_learning_tools() if PHASE >= 4 else []

    if not gateway_endpoint or not jwt_token:
        logger.warning("No gateway endpoint or JWT token, creating agent without MCP tools")
        return None, extra_tools, "No gateway endpoint or JWT token available"

    try:
        mcp_client = MCPClient(
            lambda: streamablehttp_client_with_jwt(
                url=gateway_endpoint,
                jwt_token=jwt_token,
            )
        )
        mcp_client.__enter__()
        tools = mcp_client.list_tools_sync()
        logger.info("Retrieved %d tools from Gateway with JWT auth", len(tools))

        all_tools = list(tools) + extra_tools
        return mcp_client, all_tools, None

    except Exception as e:
        logger.error("Failed to connect to Gateway with JWT: %s", e, exc_info=True)
        return None, extra_tools, str(e)


@app.entrypoint
def invoke(payload):
    """Process a user request."""
    prompt = payload.get("prompt", "")
    session_id = payload.get("sessionId", "default")
    user_id = payload.get("userId", "default")
    jwt_token = payload.get("jwt_token", "")

    if not prompt:
        return {"error": "No prompt provided"}

    logger.info("Request - session: %s, user: %s, has_jwt: %s", session_id, user_id, bool(jwt_token))

    # Fetch available actions from Remediator Gateway (cached)
    available_actions: list[str] = []
    remediator_error: str | None = None
    if jwt_token:
        try:
            available_actions = fetch_remediator_actions(jwt_token)
        except RemediatorDiscoveryError as e:
            remediator_error = str(e)
            logger.error("Remediator discovery failed: %s", e)

    # Build system prompt dynamically with discovered actions
    system_prompt = build_system_prompt(
        phase=PHASE,
        available_actions=available_actions if available_actions else None,
    )

    # Create agent with JWT-authenticated Gateway connection
    mcp_client, tools, gateway_error = create_agent_with_jwt(jwt_token)

    # Determine system prompt based on gateway availability
    active_prompt = system_prompt
    if gateway_error:
        active_prompt = (
            system_prompt
            + "\n\nCRITICAL: The cost analysis tools are currently UNAVAILABLE due to a connection error. You MUST NOT answer questions about costs, spending, or recommendations. Instead, tell the user: 'I cannot access cost data right now due to a connection issue. Please try again in a moment.' Do NOT fabricate or estimate any numbers."
        )
    if remediator_error:
        active_prompt = (
            active_prompt
            + f"\n\nCRITICAL: The Remediator Gateway failed to list available tools. Error: {remediator_error}. "
            "You MUST NOT offer any remediation actions or action buttons. If the user asks to perform "
            "a remediation action (resize, stop, terminate, delete, etc.), you MUST inform them: "
            "'Error: The remediation agent could not list available tools. Please contact your administrator "
            "to check the Remediator Gateway configuration and CloudWatch logs.' "
            "Do NOT fabricate or assume which actions are available."
        )

    logger.info("Tools available: %d, Gateway error: %s", len(tools), gateway_error or "None")

    # Create agent with memory if available
    session_manager = None
    if MEMORY_ID:
        try:
            memory_config = AgentCoreMemoryConfig(
                memory_id=MEMORY_ID,
                session_id=session_id,
                actor_id=user_id,
            )
            session_manager = AgentCoreMemorySessionManager(
                agentcore_memory_config=memory_config,
                region_name=AWS_REGION,
            )
        except Exception as e:
            logger.warning("Memory unavailable: %s", e)

    # Create single agent with tools + memory
    agent = Agent(
        model=model,
        tools=tools,
        system_prompt=active_prompt,
        session_manager=session_manager,
    )

    # Invoke - prepend account filter reminder to every cost-related query
    try:
        # Enhance prompt with explicit tool-use instruction
        enhanced_prompt = prompt
        account_id = os.environ.get("AWS_ACCOUNT_ID", "123456789012")
        cost_keywords = ["cost", "spend", "service", "bill", "expensive", "cheap", "saving", "budget", "trend", "month"]
        if any(kw in prompt.lower() for kw in cost_keywords):
            enhanced_prompt = (
                f"{prompt}\n\n"
                f"[SYSTEM REMINDER: You MUST use the billingMcp___cost-explorer tool to answer this. "
                f'Include filter parameter: \'{{"Dimensions": {{"Key": "LINKED_ACCOUNT", "Values": ["{account_id}"]}}}}\' '
                f"Do NOT answer from memory. Call the tool first.]"
            )

        result = agent(enhanced_prompt)

        # Extract message
        if hasattr(result, "message"):
            message = result.message
        elif hasattr(result, "content"):
            message = result.content
        elif isinstance(result, str):
            message = result
        else:
            message = str(result)

        if isinstance(message, dict):
            if "content" in message and isinstance(message["content"], list):
                message = "".join(item.get("text", "") for item in message["content"] if "text" in item)
            elif "text" in message:
                message = message["text"]

        return {"result": message, "sessionId": session_id, "userId": user_id}

    except Exception as e:
        logger.error("Agent invocation error: %s", e, exc_info=True)
        return {"error": str(e), "sessionId": session_id}
    finally:
        # Close MCP client connection
        if mcp_client:
            try:
                mcp_client.__exit__(None, None, None)
            except Exception:
                pass


if __name__ == "__main__":
    logger.info("Starting Cost Optimizer Recommender Agent Runtime")
    app.run()

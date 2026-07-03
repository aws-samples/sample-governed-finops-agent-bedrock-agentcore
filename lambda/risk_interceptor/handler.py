"""
Risk Level Interceptor Lambda (AgentCore Gateway REQUEST Interceptor).

Enriches the gateway request with a riskLevel attribute by querying
the CostOptRiskMappings DynamoDB table. The transformedGatewayRequest
output becomes context.input in Cedar policy evaluation.

Execution order: Request → JWT Auth → THIS INTERCEPTOR → Cedar Policy → Target
Defaults to "high" on any failure (fail-closed).
"""

import json
import logging
import os
import time
from typing import cast

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TABLE_NAME = os.environ.get("RISK_MAPPING_TABLE_NAME", "CostOptRiskMappings")
METRIC_NAMESPACE = "CostOptimizer/RiskInterceptor"

dynamodb = boto3.resource("dynamodb")
cloudwatch = boto3.client("cloudwatch")
table = dynamodb.Table(TABLE_NAME)


def _publish_latency_metric(duration_ms: float) -> None:
    """Publish lookup latency metric to CloudWatch."""
    try:
        cloudwatch.put_metric_data(
            Namespace=METRIC_NAMESPACE,
            MetricData=[
                {
                    "MetricName": "LookupLatencyMs",
                    "Value": duration_ms,
                    "Unit": "Milliseconds",
                }
            ],
        )
    except Exception as e:
        logger.warning("Failed to publish CloudWatch metric: %s", e)


def _lookup_risk_level(action_key: str) -> str:
    """Query DynamoDB for the risk level of the given action key."""
    response = table.get_item(Key={"action": action_key})
    item = response.get("Item")
    if item is None:
        logger.warning(
            "Action key not found in Risk Mapping Table: %s. Defaulting to high.",
            action_key,
        )
        return "high"
    risk_level = cast(str, item.get("riskLevel", "high"))
    if risk_level not in ("low", "medium", "high"):
        logger.warning(
            "Invalid riskLevel '%s' for action '%s'. Defaulting to high.",
            risk_level,
            action_key,
        )
        return "high"
    return risk_level


def _extract_tool_name(event: dict) -> str:
    """Extract the tool name from the MCP request body.

    The MCP tools/call request has the format:
    {"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "tool_name", ...}}
    """
    try:
        mcp = event.get("mcp", {})
        gateway_request = mcp.get("gatewayRequest", {})
        body = gateway_request.get("body", {})

        # Only enrich tools/call requests
        method = body.get("method", "")
        if method != "tools/call":
            return ""

        params = body.get("params", {})
        return cast(str, params.get("name", ""))
    except Exception:
        return ""


def handler(event: dict, context) -> dict:
    """Lambda handler for the Risk Level Interceptor.

    Receives a REQUEST interceptor event from AgentCore Gateway.
    Enriches the request body with riskLevel so Cedar can access it
    via context.input.

    Input format (from AgentCore Gateway):
    {
        "interceptorInputVersion": "1.0",
        "mcp": {
            "gatewayRequest": {
                "body": {"jsonrpc": "2.0", "method": "tools/call", "params": {...}}
            }
        }
    }

    Output format (transformedGatewayRequest with riskLevel injected):
    {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayRequest": {
                "body": {
                    ...original_body,
                    "riskLevel": "low|medium|high"
                }
            }
        }
    }
    """
    start_time = time.time()

    # Extract the original request
    mcp = event.get("mcp", {})
    gateway_request = mcp.get("gatewayRequest", {})
    body = gateway_request.get("body", {})

    # Extract tool name to look up risk level
    tool_name = _extract_tool_name(event)
    risk_level = "high"

    if tool_name:
        try:
            risk_level = _lookup_risk_level(tool_name)
        except ClientError as e:
            logger.warning(
                "DynamoDB lookup failed for %s: %s. Defaulting to high.",
                tool_name,
                e,
            )
        except Exception as e:
            logger.error(
                "Unexpected error in risk lookup for %s: %s. Defaulting to high.",
                tool_name,
                e,
            )
    else:
        # Non tools/call requests (tools/list, etc.) — pass through as low risk
        risk_level = "low"

    duration_ms = (time.time() - start_time) * 1000

    # Structured log entry
    logger.info(
        json.dumps(
            {
                "action_key": tool_name,
                "risk_level": risk_level,
                "duration_ms": round(duration_ms, 2),
            }
        )
    )

    # Publish latency metric
    _publish_latency_metric(duration_ms)

    # Return transformedGatewayRequest with riskLevel injected into body
    # This becomes context.input in Cedar policy evaluation
    enriched_body = {**body, "riskLevel": risk_level}

    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayRequest": {
                "body": enriched_body,
            }
        },
    }

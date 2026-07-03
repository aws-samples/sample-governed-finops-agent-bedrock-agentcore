"""Unit tests for lambda/risk_interceptor/handler.py."""

import sys
from pathlib import Path
from unittest.mock import patch

# Add lambda/risk_interceptor to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "lambda" / "risk_interceptor"))


class TestExtractToolName:
    """Tests for _extract_tool_name helper."""

    def test_valid_tools_call(self):
        from handler import _extract_tool_name

        event = {
            "mcp": {
                "gatewayRequest": {
                    "body": {
                        "jsonrpc": "2.0",
                        "method": "tools/call",
                        "params": {"name": "resize_instance"},
                    }
                }
            }
        }
        assert _extract_tool_name(event) == "resize_instance"

    def test_tools_list_returns_empty(self):
        from handler import _extract_tool_name

        event = {
            "mcp": {
                "gatewayRequest": {
                    "body": {
                        "jsonrpc": "2.0",
                        "method": "tools/list",
                        "params": {},
                    }
                }
            }
        }
        assert _extract_tool_name(event) == ""

    def test_empty_event_returns_empty(self):
        from handler import _extract_tool_name

        assert _extract_tool_name({}) == ""

    def test_malformed_event_returns_empty(self):
        from handler import _extract_tool_name

        assert _extract_tool_name({"mcp": {}}) == ""


class TestHandler:
    """Tests for the risk interceptor Lambda handler."""

    @patch("handler.table")
    @patch("handler._publish_latency_metric")
    def test_tools_call_with_known_action(self, mock_metric, mock_table):
        from handler import handler

        mock_table.get_item.return_value = {"Item": {"action": "resize_instance", "riskLevel": "low"}}

        event = {
            "mcp": {
                "gatewayRequest": {
                    "body": {
                        "jsonrpc": "2.0",
                        "method": "tools/call",
                        "params": {"name": "resize_instance"},
                    }
                }
            }
        }
        result = handler(event, None)

        assert result["interceptorOutputVersion"] == "1.0"
        body = result["mcp"]["transformedGatewayRequest"]["body"]
        assert body["riskLevel"] == "low"
        assert body["method"] == "tools/call"

    @patch("handler.table")
    @patch("handler._publish_latency_metric")
    def test_unknown_action_defaults_to_high(self, mock_metric, mock_table):
        from handler import handler

        mock_table.get_item.return_value = {}  # No Item

        event = {
            "mcp": {
                "gatewayRequest": {
                    "body": {
                        "jsonrpc": "2.0",
                        "method": "tools/call",
                        "params": {"name": "unknown_action"},
                    }
                }
            }
        }
        result = handler(event, None)
        body = result["mcp"]["transformedGatewayRequest"]["body"]
        assert body["riskLevel"] == "high"

    @patch("handler.table")
    @patch("handler._publish_latency_metric")
    def test_tools_list_passthrough_low_risk(self, mock_metric, mock_table):
        from handler import handler

        event = {
            "mcp": {
                "gatewayRequest": {
                    "body": {
                        "jsonrpc": "2.0",
                        "method": "tools/list",
                        "params": {},
                    }
                }
            }
        }
        result = handler(event, None)
        body = result["mcp"]["transformedGatewayRequest"]["body"]
        assert body["riskLevel"] == "low"

    @patch("handler.table")
    @patch("handler._publish_latency_metric")
    def test_dynamodb_error_defaults_to_high(self, mock_metric, mock_table):
        from botocore.exceptions import ClientError
        from handler import handler

        mock_table.get_item.side_effect = ClientError({"Error": {"Code": "500", "Message": "Internal"}}, "GetItem")

        event = {
            "mcp": {
                "gatewayRequest": {
                    "body": {
                        "jsonrpc": "2.0",
                        "method": "tools/call",
                        "params": {"name": "terminate_instance"},
                    }
                }
            }
        }
        result = handler(event, None)
        body = result["mcp"]["transformedGatewayRequest"]["body"]
        assert body["riskLevel"] == "high"

"""Unit tests for lambda/approval/approval_handler.py."""

import sys
from pathlib import Path
from unittest.mock import patch

# Add lambda/approval to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "lambda" / "approval"))


class TestApprovalHandler:
    """Tests for the approval handler Lambda."""

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_missing_token(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        event = {"queryStringParameters": {"decision": "approve"}}
        result = handler(event, None)
        assert result["statusCode"] == 400
        assert "Invalid request" in result["body"]

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_missing_decision(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        event = {"queryStringParameters": {"token": "abc123"}}
        result = handler(event, None)
        assert result["statusCode"] == 400

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_invalid_decision(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        event = {"queryStringParameters": {"token": "abc", "decision": "maybe"}}
        result = handler(event, None)
        assert result["statusCode"] == 400

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_no_query_params(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        event = {"queryStringParameters": None}
        result = handler(event, None)
        assert result["statusCode"] == 400

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_token_not_found(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        mock_table.query.return_value = {"Items": []}
        event = {"queryStringParameters": {"token": "invalid-token", "decision": "approve"}}
        result = handler(event, None)
        assert result["statusCode"] == 400
        assert "invalid" in result["body"].lower()

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_already_processed_token(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        mock_table.query.return_value = {"Items": [{"request_id": "req-1", "status": "APPROVED"}]}
        event = {"queryStringParameters": {"token": "used-token", "decision": "approve"}}
        result = handler(event, None)
        assert result["statusCode"] == 400

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_approve_success(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        mock_table.query.return_value = {
            "Items": [
                {
                    "request_id": "req-1",
                    "status": "PENDING",
                    "action_type": "resize_instance",
                    "resource_id": "i-0abc123",
                    "parameters": {"target_type": "t3.small"},
                }
            ]
        }
        event = {"queryStringParameters": {"token": "valid-token", "decision": "approve"}}
        result = handler(event, None)
        assert result["statusCode"] == 200
        assert "APPROVED" in result["body"]
        mock_lambda.invoke.assert_called_once()

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_reject_success(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import handler

        mock_table.query.return_value = {
            "Items": [
                {
                    "request_id": "req-1",
                    "status": "PENDING",
                    "action_type": "terminate_instance",
                    "resource_id": "i-0abc123",
                }
            ]
        }
        event = {"queryStringParameters": {"token": "valid-token", "decision": "reject"}}
        result = handler(event, None)
        assert result["statusCode"] == 200
        assert "DENIED" in result["body"]
        # Should NOT invoke remediation lambda
        mock_lambda.invoke.assert_not_called()

    @patch("approval_handler.table")
    @patch("approval_handler.lambda_client")
    @patch("approval_handler.sns_client")
    def test_html_response_format(self, mock_sns, mock_lambda, mock_table):
        from approval_handler import _html_response

        result = _html_response(200, "Test message")
        assert result["statusCode"] == 200
        assert result["headers"]["Content-Type"] == "text/html"
        assert "Test message" in result["body"]
        assert "<!DOCTYPE html>" in result["body"]

"""Unit tests for agentcore-remediator/resource_context.py."""

import sys
from pathlib import Path
from unittest.mock import patch

# Add agentcore-remediator to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "agentcore-remediator"))


class TestDetectResourceType:
    """Tests for _detect_resource_type helper."""

    def test_ec2_instance(self):
        from resource_context import _detect_resource_type

        assert _detect_resource_type("i-0abc123def") == "ec2:instance"

    def test_ebs_volume(self):
        from resource_context import _detect_resource_type

        assert _detect_resource_type("vol-0abc123") == "ec2:volume"

    def test_rds_instance(self):
        from resource_context import _detect_resource_type

        assert _detect_resource_type("db-ABCDEF") == "rds:instance"

    def test_snapshot(self):
        from resource_context import _detect_resource_type

        assert _detect_resource_type("snap-0abc123") == "ec2:snapshot"

    def test_unknown(self):
        from resource_context import _detect_resource_type

        assert _detect_resource_type("arn:aws:something") == "unknown"


class TestGetResourceContext:
    """Tests for get_resource_context with mocked boto3."""

    @patch("resource_context._fetch_tags")
    def test_production_environment(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = [
            {"Key": "Environment", "Value": "production"},
            {"Key": "Owner", "Value": "team-infra"},
        ]
        result = get_resource_context("i-0abc123")
        assert result["environment"] == "production"
        assert result["is_critical"] is False
        assert result["owner"] == "team-infra"
        assert result["resource_type"] == "ec2:instance"

    @patch("resource_context._fetch_tags")
    def test_development_environment(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = [
            {"Key": "Environment", "Value": "dev"},
        ]
        result = get_resource_context("i-0abc123")
        assert result["environment"] == "development"

    @patch("resource_context._fetch_tags")
    def test_staging_environment(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = [
            {"Key": "Environment", "Value": "staging"},
        ]
        result = get_resource_context("i-0abc123")
        assert result["environment"] == "staging"

    @patch("resource_context._fetch_tags")
    def test_no_environment_tag_is_unknown(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = [
            {"Key": "Name", "Value": "my-server"},
        ]
        result = get_resource_context("i-0abc123")
        assert result["environment"] == "unknown"

    @patch("resource_context._fetch_tags")
    def test_critical_do_not_modify(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = [
            {"Key": "Environment", "Value": "production"},
            {"Key": "DoNotModify", "Value": "true"},
        ]
        result = get_resource_context("i-0abc123")
        assert result["is_critical"] is True

    @patch("resource_context._fetch_tags")
    def test_critical_service_tag(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = [
            {"Key": "CriticalService", "Value": "true"},
        ]
        result = get_resource_context("i-0abc123")
        assert result["is_critical"] is True

    @patch("resource_context._fetch_tags")
    def test_no_tags_returns_development(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.return_value = []
        result = get_resource_context("vol-0abc123")
        assert result["environment"] == "development"
        assert result["is_critical"] is False
        assert result["resource_type"] == "ec2:volume"

    @patch("resource_context._fetch_tags")
    def test_fetch_failure_returns_safe_defaults(self, mock_fetch):
        from resource_context import get_resource_context

        mock_fetch.side_effect = Exception("Connection timeout")
        result = get_resource_context("i-0abc123")
        assert result["environment"] == "development"
        assert result["is_critical"] is False

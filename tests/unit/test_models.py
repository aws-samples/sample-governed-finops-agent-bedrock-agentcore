"""Unit tests for agentcore/models.py - Data model validations."""

import sys
from pathlib import Path

import pytest

# Add src/recommender to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src" / "recommender"))

from models import (
    Recommendation,
    RemediationAction,
    RuntimeConfig,
    UserPreferences,
)


class TestRecommendation:
    """Tests for the Recommendation dataclass."""

    def _make_recommendation(self, **overrides):
        defaults = {
            "id": "rec-001",
            "source": "cost-explorer",
            "category": "rightsizing",
            "resource_id": "i-0abc123",
            "resource_type": "ec2:instance",
            "current_cost": 100.0,
            "estimated_savings": 30.0,
            "risk_level": "low",
            "action": "resize_instance",
        }
        defaults.update(overrides)
        return Recommendation(**defaults)

    def test_valid_recommendation(self):
        rec = self._make_recommendation()
        assert rec.id == "rec-001"
        assert rec.estimated_savings == 30.0
        assert rec.risk_level == "low"

    def test_savings_percentage(self):
        rec = self._make_recommendation(current_cost=200.0, estimated_savings=50.0)
        assert rec.savings_percentage == 25.0

    def test_savings_percentage_zero_cost(self):
        rec = self._make_recommendation(current_cost=0.0, estimated_savings=0.0)
        assert rec.savings_percentage == 0.0

    def test_negative_savings_raises(self):
        with pytest.raises(ValueError, match="estimated_savings must be >= 0"):
            self._make_recommendation(estimated_savings=-10.0)

    def test_invalid_risk_level_raises(self):
        with pytest.raises(ValueError, match="risk_level must be one of"):
            self._make_recommendation(risk_level="critical")

    def test_invalid_priority_score_raises(self):
        with pytest.raises(ValueError, match="priority_score must be between"):
            self._make_recommendation(priority_score=1.5)

    def test_empty_resource_id_raises(self):
        with pytest.raises(ValueError, match="resource_id must not be empty"):
            self._make_recommendation(resource_id="")

    def test_negative_current_cost_raises(self):
        with pytest.raises(ValueError, match="current_cost must be >= 0"):
            self._make_recommendation(current_cost=-5.0)


class TestRemediationAction:
    """Tests for the RemediationAction dataclass."""

    def _make_action(self, **overrides):
        defaults = {
            "id": "act-001",
            "recommendation_id": "rec-001",
            "action_type": "resize_instance",
            "resource_id": "i-0abc123",
            "requires_role": "engineer",
            "risk_level": "low",
        }
        defaults.update(overrides)
        return RemediationAction(**defaults)

    def test_valid_action(self):
        action = self._make_action()
        assert action.action_type == "resize_instance"
        assert action.requires_role == "engineer"

    def test_invalid_action_type_raises(self):
        with pytest.raises(ValueError, match="action_type must be one of"):
            self._make_action(action_type="reboot_instance")

    def test_invalid_role_raises(self):
        with pytest.raises(ValueError, match="requires_role must be one of"):
            self._make_action(requires_role="admin")

    def test_invalid_risk_level_raises(self):
        with pytest.raises(ValueError, match="risk_level must be one of"):
            self._make_action(risk_level="extreme")

    def test_high_risk_without_rollback_raises(self):
        with pytest.raises(ValueError, match="High-risk actions require a rollback_action"):
            self._make_action(risk_level="high", rollback_action=None)

    def test_high_risk_with_rollback_ok(self):
        action = self._make_action(
            action_type="terminate_instance",
            risk_level="high",
            rollback_action="launch_instance",
        )
        assert action.rollback_action == "launch_instance"

    def test_to_cedar_request(self):
        action = self._make_action(
            parameters={"estimated_savings": 50.0},
            estimated_downtime="5 minutes",
        )
        cedar = action.to_cedar_request("engineer")
        assert cedar["principal"] == 'Role::"engineer"'
        assert cedar["action"] == 'Action::"resize_instance"'
        assert cedar["resource"] == 'Resource::"i-0abc123"'
        assert cedar["context"]["risk_level"] == "low"
        assert cedar["context"]["estimated_savings"] == 50.0
        assert cedar["context"]["requires_downtime"] is True


class TestRuntimeConfig:
    """Tests for the RuntimeConfig dataclass."""

    def test_gateway_endpoint(self):
        config = RuntimeConfig(
            gateway_arn="arn:aws:bedrock-agentcore:us-east-1:123456789012:gateway/my-gw-id",
            memory_id="mem-123",
        )
        assert config.gateway_endpoint == "https://my-gw-id.gateway.bedrock-agentcore.us-east-1.amazonaws.com/mcp"

    def test_default_model(self):
        config = RuntimeConfig(gateway_arn="arn:test", memory_id="mem-1")
        assert "claude" in config.model_id


class TestUserPreferences:
    """Tests for the UserPreferences dataclass."""

    def test_defaults(self):
        prefs = UserPreferences()
        assert prefs.user_id == ""
        assert prefs.risk_tolerance == "medium"
        assert prefs.accepted_categories == {}
        assert prefs.rejected_categories == {}

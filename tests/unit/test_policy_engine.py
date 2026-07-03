"""Unit tests for agentcore-remediator/policy_engine.py."""

import sys
from pathlib import Path

# Add src/remediator to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src" / "remediator"))

from policy_engine import AuthorizationResult, RemediatorPolicy


class TestRemediatorPolicy:
    """Tests for the RemediatorPolicy authorization logic."""

    def setup_method(self):
        self.policy = RemediatorPolicy(policy_store_id="test-store")

    def test_low_risk_allows(self):
        result = self.policy.authorize("resize_instance", risk_level="low")
        assert result.decision == "ALLOW"
        assert result.risk_level == "low"

    def test_medium_risk_allows(self):
        result = self.policy.authorize("stop_instance", risk_level="medium")
        assert result.decision == "ALLOW"
        assert result.risk_level == "medium"

    def test_high_risk_requires_approval(self):
        result = self.policy.authorize("terminate_instance", risk_level="high")
        assert result.decision == "REQUIRES_APPROVAL"
        assert result.risk_level == "high"
        assert "human approval" in result.reason.lower()

    def test_invalid_risk_level_defaults_to_high(self):
        result = self.policy.authorize("resize_instance", risk_level="critical")
        assert result.decision == "REQUIRES_APPROVAL"
        assert result.risk_level == "high"

    def test_default_risk_level_is_high(self):
        """Default parameter is 'high' (fail-closed)."""
        result = self.policy.authorize("terminate_instance")
        assert result.decision == "REQUIRES_APPROVAL"

    def test_add_tag_low_risk(self):
        result = self.policy.authorize("add_tag", risk_level="low")
        assert result.decision == "ALLOW"

    def test_delete_ebs_volume_high_risk(self):
        result = self.policy.authorize("delete_ebs_volume", risk_level="high")
        assert result.decision == "REQUIRES_APPROVAL"


class TestAuthorizationResult:
    """Tests for the AuthorizationResult dataclass."""

    def test_defaults(self):
        result = AuthorizationResult(decision="ALLOW")
        assert result.reason == ""
        assert result.risk_level == "low"

    def test_custom_values(self):
        result = AuthorizationResult(
            decision="REQUIRES_APPROVAL",
            reason="High risk action",
            risk_level="high",
        )
        assert result.decision == "REQUIRES_APPROVAL"
        assert result.reason == "High risk action"

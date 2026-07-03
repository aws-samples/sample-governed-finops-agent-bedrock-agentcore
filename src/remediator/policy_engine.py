"""
Policy Engine for the Remediator Agent.

Simplified: Cedar policies at the AgentCore Gateway handle all role-based
access control. The Lambda Interceptor resolves risk level from DynamoDB.

This module only determines if a high-risk action needs HITL approval.
All actions are logged to the audit trail regardless of outcome.
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class AuthorizationResult:
    """Result of policy evaluation."""

    decision: str  # ALLOW or REQUIRES_APPROVAL
    reason: str = ""
    risk_level: str = "low"


class RemediatorPolicy:
    """Risk-based HITL trigger for remediation actions.

    Cedar policies handle: who can do what (role + risk level)
    This engine handles: should we require human approval before executing?

    Rule: high-risk actions require HITL approval, everything else executes immediately.
    """

    def __init__(self, policy_store_id: str = ""):
        self.policy_store_id = policy_store_id

    def authorize(
        self,
        action_type: str,
        risk_level: str = "high",
    ) -> AuthorizationResult:
        """Determine if an action requires HITL approval.

        Args:
            action_type: The remediation action (e.g., "add_tag", "terminate_instance")
            risk_level: Risk level from the interceptor Lambda ("low", "medium", "high").
                       Defaults to "high" (fail-closed) if not provided.

        Returns:
            ALLOW: execute immediately (low/medium risk)
            REQUIRES_APPROVAL: trigger HITL flow (high risk)
        """
        # Validate risk_level
        if risk_level not in ("low", "medium", "high"):
            logger.warning("Invalid risk_level '%s' for '%s'. Defaulting to high.", risk_level, action_type)
            risk_level = "high"

        logger.info("Policy check: action=%s, risk_level=%s", action_type, risk_level)

        if risk_level == "high":
            return AuthorizationResult(
                decision="REQUIRES_APPROVAL",
                reason=f"High-risk action '{action_type}' requires human approval.",
                risk_level=risk_level,
            )

        return AuthorizationResult(
            decision="ALLOW",
            reason="Action authorized. Low/medium risk, no approval needed.",
            risk_level=risk_level,
        )

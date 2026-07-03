"""Data models for AgentCore Cost Optimizer.

Defines the core dataclasses used throughout the system:
- RuntimeConfig: Agent runtime configuration
- Recommendation: Cost optimization recommendation
- RemediationAction: Executable remediation action with Cedar authorization
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Valid action types for remediation
VALID_ACTION_TYPES = frozenset(
    {
        "resize_instance",
        "stop_instance",
        "terminate_instance",
        "delete_volume",
        "modify_storage",
        "purchase_savings_plan",
    }
)

VALID_RISK_LEVELS = frozenset({"low", "medium", "high"})
VALID_ROLES = frozenset({"analyst", "engineer", "manager"})
VALID_CATEGORIES = frozenset(
    {
        "rightsizing",
        "idle_resources",
        "savings_plans",
        "reserved_instances",
    }
)


@dataclass
class RuntimeConfig:
    """Configuration for the agent runtime."""

    gateway_arn: str
    memory_id: str
    model_id: str = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
    region: str = "us-east-1"
    policy_store_id: str | None = None  # Phase 3

    @property
    def gateway_endpoint(self) -> str:
        """Derive the Gateway HTTP endpoint from the ARN."""
        gateway_id = self.gateway_arn.split("/")[-1]
        return f"https://{gateway_id}.gateway.bedrock-agentcore.{self.region}.amazonaws.com/mcp"


@dataclass
class Recommendation:
    """A cost optimization recommendation.

    Validations (Requirement 18.1):
    - estimated_savings >= 0
    - risk_level in {"low", "medium", "high"}
    - priority_score between 0.0 and 1.0
    - resource_id not empty
    - current_cost >= 0
    """

    id: str
    source: str
    category: str
    resource_id: str
    resource_type: str
    current_cost: float
    estimated_savings: float
    risk_level: str
    action: str
    details: dict = field(default_factory=dict)
    priority_score: float = 0.0

    def __post_init__(self) -> None:
        if self.estimated_savings < 0:
            raise ValueError(f"estimated_savings must be >= 0, got {self.estimated_savings}")
        if self.risk_level not in VALID_RISK_LEVELS:
            raise ValueError(f"risk_level must be one of {VALID_RISK_LEVELS}, got '{self.risk_level}'")
        if not (0.0 <= self.priority_score <= 1.0):
            raise ValueError(f"priority_score must be between 0.0 and 1.0, got {self.priority_score}")
        if not self.resource_id:
            raise ValueError("resource_id must not be empty")
        if self.current_cost < 0:
            raise ValueError(f"current_cost must be >= 0, got {self.current_cost}")

    @property
    def savings_percentage(self) -> float:
        """Calculate savings as a percentage of current cost."""
        if self.current_cost == 0:
            return 0.0
        return (self.estimated_savings / self.current_cost) * 100


@dataclass
class RemediationAction:
    """An executable remediation action.

    Validations (Requirements 18.2, 18.3, 18.4):
    - action_type must be a registered type
    - requires_role must be "analyst", "engineer", or "manager"
    - risk_level must be consistent with action_type
    - High-risk actions require a rollback_action
    """

    id: str
    recommendation_id: str
    action_type: str
    resource_id: str
    parameters: dict = field(default_factory=dict)
    requires_role: str = "engineer"
    risk_level: str = "low"
    estimated_downtime: str | None = None
    rollback_action: str | None = None

    def __post_init__(self) -> None:
        if self.action_type not in VALID_ACTION_TYPES:
            raise ValueError(f"action_type must be one of {VALID_ACTION_TYPES}, got '{self.action_type}'")
        if self.requires_role not in VALID_ROLES:
            raise ValueError(f"requires_role must be one of {VALID_ROLES}, got '{self.requires_role}'")
        if self.risk_level not in VALID_RISK_LEVELS:
            raise ValueError(f"risk_level must be one of {VALID_RISK_LEVELS}, got '{self.risk_level}'")
        if self.risk_level == "high" and self.rollback_action is None:
            raise ValueError("High-risk actions require a rollback_action to be defined")

    def to_cedar_request(self, principal_role: str) -> dict:
        """Convert to Cedar authorization request format.

        Returns a dict with:
        - principal: Role::"<role>"
        - action: Action::"<action_type>"
        - resource: Resource::"<resource_id>"
        - context: risk_level, estimated_savings, requires_downtime
        """
        return {
            "principal": f'Role::"{principal_role}"',
            "action": f'Action::"{self.action_type}"',
            "resource": f'Resource::"{self.resource_id}"',
            "context": {
                "risk_level": self.risk_level,
                "estimated_savings": self.parameters.get("estimated_savings", 0),
                "requires_downtime": (self.estimated_downtime is not None and self.estimated_downtime != "none"),
            },
        }


@dataclass
class UserPreferences:
    """User preferences learned from feedback history (Phase 4).

    Tracks which recommendation categories the user accepts/rejects
    to adjust future prioritization.
    """

    user_id: str = ""
    accepted_categories: dict = field(default_factory=dict)
    rejected_categories: dict = field(default_factory=dict)
    risk_tolerance: str = "medium"
    preferred_savings_threshold: float = 0.0
    last_updated: str = ""

"""
Resource Context Checker for the Remediator Agent.

Determines environment, criticality, and ownership of a resource
by inspecting its tags. Used as input for Cedar policy evaluation.
"""

import logging

import boto3

logger = logging.getLogger(__name__)

ec2 = boto3.client("ec2", region_name="us-east-1")


def get_resource_context(resource_id: str) -> dict:
    """Get resource tags and determine environment/criticality.

    Returns:
        {
            environment: production|staging|development|unknown,
            is_critical: bool,
            tags: dict,
            resource_type: str,
            owner: str
        }

    Rules:
    - If tag Environment exists: use its value (production/staging/development)
    - If no Environment tag: treat as "unknown" (same restrictions as production)
    - If tag DoNotModify=true or CriticalService=true: is_critical=True
    - If no tags at all: treat as production + critical (maximum safety)
    """
    try:
        tags = _fetch_tags(resource_id)
    except Exception as e:
        logger.warning(
            "Failed to fetch tags for %s: %s. Treating as development/non-critical for demo.", resource_id, e
        )
        return {
            "environment": "development",
            "is_critical": False,
            "tags": {},
            "resource_type": _detect_resource_type(resource_id),
            "owner": "unknown",
        }

    # No tags = treat as development for demo (non-critical)
    if not tags:
        return {
            "environment": "development",
            "is_critical": False,
            "tags": {},
            "resource_type": _detect_resource_type(resource_id),
            "owner": "unknown",
        }

    tag_dict = {t["Key"]: t["Value"] for t in tags}

    # Determine environment
    env_value = tag_dict.get("Environment", tag_dict.get("environment", "")).lower()
    if env_value in ("production", "prod"):
        environment = "production"
    elif env_value in ("staging", "stage", "stg"):
        environment = "staging"
    elif env_value in ("development", "dev"):
        environment = "development"
    else:
        environment = "unknown"

    # Determine criticality
    do_not_modify = tag_dict.get("DoNotModify", "").lower() == "true"
    critical_service = tag_dict.get("CriticalService", "").lower() == "true"
    is_critical = do_not_modify or critical_service

    # Owner
    owner = tag_dict.get("Owner", tag_dict.get("owner", "unknown"))

    return {
        "environment": environment,
        "is_critical": is_critical,
        "tags": tag_dict,
        "resource_type": _detect_resource_type(resource_id),
        "owner": owner,
    }


def _fetch_tags(resource_id: str) -> list:
    """Fetch tags for a resource using EC2 DescribeTags."""
    response = ec2.describe_tags(Filters=[{"Name": "resource-id", "Values": [resource_id]}])
    return [{"Key": t["Key"], "Value": t["Value"]} for t in response.get("Tags", [])]


def _detect_resource_type(resource_id: str) -> str:
    """Detect resource type from ID prefix."""
    if resource_id.startswith("i-"):
        return "ec2:instance"
    elif resource_id.startswith("vol-"):
        return "ec2:volume"
    elif resource_id.startswith("db-"):
        return "rds:instance"
    elif resource_id.startswith("snap-"):
        return "ec2:snapshot"
    return "unknown"

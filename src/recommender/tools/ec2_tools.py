"""
EC2 Describe Instances tool for the Cost Optimizer agent.

Provides real-time visibility into EC2 instances (running, stopped, etc.)
so the agent can make recommendations based on actual resource state
instead of relying solely on Cost Explorer billing data.
"""

import logging
from typing import Any

import boto3
from strands import tool

logger = logging.getLogger(__name__)

_ec2_client = None


def _get_ec2_client():
    """Lazy-initialize EC2 client."""
    global _ec2_client
    if _ec2_client is None:
        _ec2_client = boto3.client("ec2", region_name="us-east-1")
    return _ec2_client


@tool
def describe_ec2_instances(
    state_filter: str = "all",
    instance_ids: str = "",
) -> dict:
    """List EC2 instances with their current state, type, tags, and launch time.

    Use this tool to get real-time information about EC2 instances.
    This is more accurate than Cost Explorer for knowing which instances
    currently exist and their state.

    Args:
        state_filter: Filter by state. Options: "running", "stopped", "all". Default: "all"
        instance_ids: Comma-separated instance IDs to filter (optional). Example: "i-abc123,i-def456"

    Returns:
        Dict with list of instances and their details (id, type, state, tags, launch_time, az).
    """
    try:
        ec2_client = _get_ec2_client()
        filters: list[dict[str, Any]] = []
        if state_filter and state_filter != "all":
            filters.append({"Name": "instance-state-name", "Values": [state_filter]})

        kwargs: dict[str, Any] = {}
        if filters:
            kwargs["Filters"] = filters
        if instance_ids:
            kwargs["InstanceIds"] = [i.strip() for i in instance_ids.split(",") if i.strip()]

        response = ec2_client.describe_instances(**kwargs)

        instances = []
        for reservation in response.get("Reservations", []):
            for inst in reservation.get("Instances", []):
                tags = {t["Key"]: t["Value"] for t in inst.get("Tags", [])}
                instances.append(
                    {
                        "instance_id": inst["InstanceId"],
                        "instance_type": inst["InstanceType"],
                        "state": inst["State"]["Name"],
                        "availability_zone": inst.get("Placement", {}).get("AvailabilityZone", ""),
                        "launch_time": inst.get("LaunchTime", "").isoformat() if inst.get("LaunchTime") else "",
                        "name": tags.get("Name", ""),
                        "tags": tags,
                        "platform": inst.get("PlatformDetails", "Linux/UNIX"),
                    }
                )

        return {
            "total_instances": len(instances),
            "instances": instances,
            "filter_applied": state_filter,
        }

    except Exception as e:
        logger.error("Failed to describe EC2 instances: %s", e)
        return {"error": str(e), "instances": []}

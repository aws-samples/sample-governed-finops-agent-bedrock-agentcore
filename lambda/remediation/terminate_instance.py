"""
Lambda: terminate_instance

Permanently terminates an EC2 instance.
Risk level: HIGH - Should only be called after HITL approval.
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Terminate an EC2 instance.

    Input: {resource_id}
    Output: {success, instance_id}

    WARNING: This action is irreversible. Only invoke after human approval.
    """
    resource_id = event.get("resource_id", "")

    if not resource_id:
        return {"success": False, "error": "resource_id is required"}

    logger.info("Terminating instance %s (HITL-approved)", resource_id)

    try:
        # Verify instance exists
        desc = ec2.describe_instances(InstanceIds=[resource_id])
        instance = desc["Reservations"][0]["Instances"][0]
        current_state = instance["State"]["Name"]

        if current_state == "terminated":
            return {"success": False, "error": "Instance is already terminated", "instance_id": resource_id}

        # Terminate
        ec2.terminate_instances(InstanceIds=[resource_id])

        # Verify termination initiated
        desc = ec2.describe_instances(InstanceIds=[resource_id])
        new_state = desc["Reservations"][0]["Instances"][0]["State"]["Name"]

        return {
            "success": True,
            "instance_id": resource_id,
            "previous_state": current_state,
            "current_state": new_state,
        }

    except Exception as e:
        logger.error("Failed to terminate instance %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "instance_id": resource_id}

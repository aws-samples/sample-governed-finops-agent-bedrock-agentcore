"""
Lambda: stop_instance

Stops a running EC2 instance with state verification.
Risk level: MEDIUM
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Stop an EC2 instance.

    Input: {resource_id}
    Output: {success, instance_id, previous_state, current_state}
    """
    resource_id = event.get("resource_id", "")

    if not resource_id:
        return {"success": False, "error": "resource_id is required"}

    logger.info("Stopping instance %s", resource_id)

    try:
        # Verify current state
        desc = ec2.describe_instances(InstanceIds=[resource_id])
        instance = desc["Reservations"][0]["Instances"][0]
        previous_state = instance["State"]["Name"]

        if previous_state != "running":
            return {
                "success": False,
                "error": f"Instance is '{previous_state}', not running",
                "instance_id": resource_id,
                "previous_state": previous_state,
            }

        # Stop instance
        ec2.stop_instances(InstanceIds=[resource_id])
        waiter = ec2.get_waiter("instance_stopped")
        waiter.wait(InstanceIds=[resource_id], WaiterConfig={"Delay": 10, "MaxAttempts": 30})

        # Verify stopped
        desc = ec2.describe_instances(InstanceIds=[resource_id])
        current_state = desc["Reservations"][0]["Instances"][0]["State"]["Name"]

        return {
            "success": True,
            "instance_id": resource_id,
            "previous_state": previous_state,
            "current_state": current_state,
        }

    except Exception as e:
        logger.error("Failed to stop instance %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "instance_id": resource_id}

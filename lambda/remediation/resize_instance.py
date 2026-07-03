"""
Lambda: resize_instance

Resizes an EC2 instance by stopping it, modifying the instance type, and restarting.
Risk level: LOW
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Resize an EC2 instance to a new type.

    Input: {resource_id, target_type}
    Output: {success, previous_type, current_type, instance_id}
    """
    resource_id = event.get("resource_id", "")
    target_type = event.get("target_type", "")

    if not resource_id or not target_type:
        return {"success": False, "error": "resource_id and target_type are required"}

    logger.info("Resizing instance %s to %s", resource_id, target_type)

    try:
        # Get current state
        desc = ec2.describe_instances(InstanceIds=[resource_id])
        instance = desc["Reservations"][0]["Instances"][0]
        previous_type = instance["InstanceType"]
        current_state = instance["State"]["Name"]

        if previous_type == target_type:
            return {
                "success": True,
                "previous_type": previous_type,
                "current_type": target_type,
                "instance_id": resource_id,
                "message": "Already the target type",
            }

        # Stop instance if running
        if current_state == "running":
            logger.info("Stopping instance %s", resource_id)
            ec2.stop_instances(InstanceIds=[resource_id])
            waiter = ec2.get_waiter("instance_stopped")
            waiter.wait(InstanceIds=[resource_id], WaiterConfig={"Delay": 10, "MaxAttempts": 30})

        # Modify instance type
        logger.info("Modifying instance type to %s", target_type)
        ec2.modify_instance_attribute(InstanceId=resource_id, InstanceType={"Value": target_type})

        # Start instance
        logger.info("Starting instance %s", resource_id)
        ec2.start_instances(InstanceIds=[resource_id])
        waiter = ec2.get_waiter("instance_running")
        waiter.wait(InstanceIds=[resource_id], WaiterConfig={"Delay": 10, "MaxAttempts": 30})

        # Verify
        desc = ec2.describe_instances(InstanceIds=[resource_id])
        current_type = desc["Reservations"][0]["Instances"][0]["InstanceType"]

        return {
            "success": True,
            "instance_id": resource_id,
            "previous_type": previous_type,
            "current_type": current_type,
        }

    except Exception as e:
        logger.error("Failed to resize instance %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "instance_id": resource_id}

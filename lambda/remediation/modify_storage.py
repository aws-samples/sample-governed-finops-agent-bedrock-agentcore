"""
Lambda: modify_storage

Modifies an EBS volume (size or type).
Risk level: LOW
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Modify an EBS volume.

    Input: {resource_id, target_size (optional), target_type (optional: gp3/gp2/io1)}
    Output: {success, volume_id, previous_size, current_size}
    """
    resource_id = event.get("resource_id", "")
    target_size = event.get("target_size")
    target_type = event.get("target_type")

    if not resource_id:
        return {"success": False, "error": "resource_id is required"}

    if not target_size and not target_type:
        return {"success": False, "error": "target_size or target_type is required"}

    logger.info("Modifying volume %s: size=%s, type=%s", resource_id, target_size, target_type)

    try:
        # Get current volume info
        desc = ec2.describe_volumes(VolumeIds=[resource_id])
        volume = desc["Volumes"][0]
        previous_size = volume["Size"]
        previous_type = volume["VolumeType"]

        # Build modification params
        modify_params = {"VolumeId": resource_id}
        if target_size:
            modify_params["Size"] = int(target_size)
        if target_type:
            modify_params["VolumeType"] = target_type

        # Modify volume
        ec2.modify_volume(**modify_params)

        # Verify modification initiated
        desc = ec2.describe_volumes(VolumeIds=[resource_id])
        current_volume = desc["Volumes"][0]

        return {
            "success": True,
            "volume_id": resource_id,
            "previous_size": previous_size,
            "previous_type": previous_type,
            "current_size": current_volume["Size"],
            "current_type": current_volume["VolumeType"],
        }

    except Exception as e:
        logger.error("Failed to modify volume %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "volume_id": resource_id}

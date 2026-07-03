"""
Lambda: delete_ebs_volume

Deletes an unattached EBS volume.
Risk level: HIGH (permanent data loss)
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Delete an unattached EBS volume.

    Input: {resource_id}
    Output: {success, volume_id, size_gb, volume_type}

    Safety: Only deletes volumes in 'available' state (not attached to any instance).
    """
    resource_id = event.get("resource_id", "")

    if not resource_id:
        return {"success": False, "error": "resource_id is required"}

    if not resource_id.startswith("vol-"):
        return {"success": False, "error": f"Invalid volume ID: {resource_id}. Must start with 'vol-'"}

    logger.info("Deleting EBS volume %s", resource_id)

    try:
        # Get volume info
        desc = ec2.describe_volumes(VolumeIds=[resource_id])
        volume = desc["Volumes"][0]
        size_gb = volume["Size"]
        volume_type = volume["VolumeType"]
        state = volume["State"]
        attachments = volume.get("Attachments", [])

        # Safety check: only delete unattached volumes
        if state != "available":
            return {
                "success": False,
                "error": f"Volume {resource_id} is in state '{state}'. Only 'available' (unattached) volumes can be deleted.",
                "volume_id": resource_id,
            }

        if attachments:
            attached_instances = [a["InstanceId"] for a in attachments]
            return {
                "success": False,
                "error": f"Volume {resource_id} is attached to {attached_instances}. Detach first.",
                "volume_id": resource_id,
            }

        # Delete volume
        ec2.delete_volume(VolumeId=resource_id)

        logger.info("Successfully deleted volume %s (%d GB, %s)", resource_id, size_gb, volume_type)

        return {
            "success": True,
            "volume_id": resource_id,
            "size_gb": size_gb,
            "volume_type": volume_type,
            "message": f"Volume {resource_id} ({size_gb} GB, {volume_type}) deleted successfully",
        }

    except ec2.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidVolume.NotFound":
            return {"success": False, "error": f"Volume {resource_id} not found"}
        logger.error("Failed to delete volume %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "volume_id": resource_id}
    except Exception as e:
        logger.error("Failed to delete volume %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "volume_id": resource_id}

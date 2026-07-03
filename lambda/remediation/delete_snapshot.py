"""
Lambda: delete_snapshot

Deletes an EBS snapshot.
Risk level: MEDIUM (data loss if snapshot is needed for recovery)
"""

import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Delete an EBS snapshot.

    Input: {resource_id}
    Output: {success, snapshot_id, size_gb, description}
    """
    resource_id = event.get("resource_id", "")

    if not resource_id:
        return {"success": False, "error": "resource_id is required"}

    if not resource_id.startswith("snap-"):
        return {"success": False, "error": f"Invalid snapshot ID: {resource_id}. Must start with 'snap-'"}

    logger.info("Deleting snapshot %s", resource_id)

    try:
        # Get snapshot info before deletion
        desc = ec2.describe_snapshots(SnapshotIds=[resource_id])
        snapshot = desc["Snapshots"][0]
        size_gb = snapshot["VolumeSize"]
        description = snapshot.get("Description", "")
        state = snapshot["State"]

        if state != "completed":
            return {"success": False, "error": f"Snapshot {resource_id} is in state '{state}', cannot delete"}

        # Delete snapshot
        ec2.delete_snapshot(SnapshotId=resource_id)

        logger.info("Successfully deleted snapshot %s (%d GB)", resource_id, size_gb)

        return {
            "success": True,
            "snapshot_id": resource_id,
            "size_gb": size_gb,
            "description": description,
            "message": f"Snapshot {resource_id} ({size_gb} GB) deleted successfully",
        }

    except ec2.exceptions.ClientError as e:
        error_code = e.response["Error"]["Code"]
        if error_code == "InvalidSnapshot.InUse":
            return {"success": False, "error": f"Snapshot {resource_id} is in use by an AMI and cannot be deleted"}
        logger.error("Failed to delete snapshot %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "snapshot_id": resource_id}
    except Exception as e:
        logger.error("Failed to delete snapshot %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "snapshot_id": resource_id}

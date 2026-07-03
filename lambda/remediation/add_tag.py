"""
Lambda: add_tag

Adds tags to EC2/RDS resources for cost allocation.
Risk level: LOW
"""

import json
import logging

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ec2 = boto3.client("ec2")


def handler(event, context):
    """Add tags to a resource.

    Input: {resource_id, tags: [{Key, Value}]}
    Output: {success, resource_id, tags_added}
    """
    resource_id = event.get("resource_id", "")
    tags = event.get("tags", [])

    # Handle tags passed as JSON string (from frontend)
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            return {"success": False, "error": "Invalid tags format"}

    if not resource_id:
        return {"success": False, "error": "resource_id is required"}

    if not tags:
        return {"success": False, "error": "tags list is required"}

    logger.info("Adding %d tags to %s", len(tags), resource_id)

    try:
        ec2.create_tags(Resources=[resource_id], Tags=tags)

        return {
            "success": True,
            "resource_id": resource_id,
            "tags_added": tags,
        }

    except Exception as e:
        logger.error("Failed to add tags to %s: %s", resource_id, e)
        return {"success": False, "error": str(e), "resource_id": resource_id}

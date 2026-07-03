"""
Lambda: approval_timeout
Triggered by EventBridge every hour. Finds PENDING requests past
their expires_at and marks them as EXPIRED, notifying the requester.
"""

import os
from datetime import datetime

import boto3
from boto3.dynamodb.conditions import Attr

TABLE_NAME = os.environ.get("TABLE_NAME", "PendingApprovals")
AUDIT_TABLE_NAME = os.environ.get("AUDIT_TABLE_NAME", "RemediationAuditLog")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
audit_table = dynamodb.Table(AUDIT_TABLE_NAME)
sns_client = boto3.client("sns")


def handler(event, context):
    """Scan for expired PENDING requests and mark them EXPIRED."""
    now_epoch = int(datetime.utcnow().timestamp())

    # Scan for PENDING items whose expires_at has passed
    resp = table.scan(FilterExpression=Attr("status").eq("PENDING") & Attr("expires_at").lte(now_epoch))

    expired_count = 0
    for item in resp.get("Items", []):
        request_id = item["request_id"]
        action_id = item.get("action_id")

        # Update approval request to EXPIRED
        table.update_item(
            Key={"request_id": request_id},
            UpdateExpression="SET #s = :s",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "EXPIRED"},
        )

        # Update audit log: REQUIRES_APPROVAL → DENY (expired)
        if action_id:
            _update_audit_on_expiration(action_id)

        # Notify requester
        if SNS_TOPIC_ARN:
            sns_client.publish(
                TopicArn=SNS_TOPIC_ARN,
                Subject="Approval Request Expired",
                Message=(
                    f"Request {request_id} ({item.get('action_type', '')} on "
                    f"{item.get('resource_id', '')}) expired without a response."
                ),
            )
        expired_count += 1

    return {"expired_count": expired_count}


def _update_audit_on_expiration(action_id: str):
    """Update audit log when HITL request expires without response."""
    try:
        # Query to get timestamp (SK)
        response = audit_table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("action_id").eq(action_id),
            Limit=1,
        )
        items = response.get("Items", [])
        if not items:
            return

        timestamp = items[0]["timestamp"]
        audit_table.update_item(
            Key={"action_id": action_id, "timestamp": timestamp},
            UpdateExpression="SET decision = :d, error_message = :e",
            ExpressionAttributeValues={":d": "DENY", ":e": "Approval request expired"},
        )
    except Exception as e:
        print(f"Failed to update audit on expiration: {e}")

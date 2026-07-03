"""
Lambda handler to query RemediationAuditLog table for execution history.
Returns audit records for a given user email.
"""

import json
import os
from decimal import Decimal
from typing import Any, Dict, Optional

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
TABLE_NAME = os.environ["AUDIT_TABLE_NAME"]
table = dynamodb.Table(TABLE_NAME)


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types from DynamoDB."""

    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


def query_user_audit_history(
    user_email: Optional[str] = None, limit: int = 50, last_key: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Query audit log. If user_email provided, filter by user. Otherwise return all records.

    Args:
        user_email: Optional user email to filter by. If None, returns all records.
        limit: Maximum number of records to return
        last_key: Pagination token from previous query

    Returns:
        Dict with items and optional pagination token
    """
    if user_email:
        # Query GSI by user_email
        query_params = {
            "IndexName": "user-timestamp-index",
            "KeyConditionExpression": Key("user_email").eq(user_email),
            "Limit": limit,
            "ScanIndexForward": False,  # Most recent first
        }

        if last_key:
            query_params["ExclusiveStartKey"] = last_key

        response = table.query(**query_params)
    else:
        # Scan entire table (no user filter)
        scan_params = {
            "Limit": limit,
        }

        if last_key:
            scan_params["ExclusiveStartKey"] = last_key

        response = table.scan(**scan_params)

    result = {
        "items": response.get("Items", []),
    }

    if "LastEvaluatedKey" in response:
        result["lastKey"] = response["LastEvaluatedKey"]

    return result


def transform_audit_record(item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Transform DynamoDB item to match ExecutionRecord interface.

    DynamoDB schema:
    - action_id (PK): unique ID
    - timestamp (SK): ISO timestamp
    - user_email: requester email
    - decision: ALLOW | DENY | REQUIRES_APPROVAL
    - action_type: resize_instance | stop_instance | etc.
    - resource_id: i-xxx, vol-xxx, etc.
    - resource_type: EC2 | EBS | RDS | etc.
    - parameters: action parameters (dict)
    - completed_at: completion timestamp (optional)
    - savings: estimated savings (optional)
    - error_message: error details (optional)
    """
    # Map decision to RemediationStatus
    status_map = {
        "ALLOW": "success",
        "DENY": "denied",
        "REQUIRES_APPROVAL": "pending_approval",
    }

    decision = item.get("decision", "DENY")
    status = status_map.get(decision, "error")

    # Build action description from action_type and parameters
    action_type = item.get("action_type", "unknown")
    parameters = item.get("parameters", {})

    action_descriptions = {
        "resize_instance": f"Resize instance to {parameters.get('target_instance_type', 'unknown')}",
        "stop_instance": "Stop instance",
        "terminate_instance": "Terminate instance",
        "delete_volume": "Delete volume",
        "delete_snapshot": "Delete snapshot",
        "add_tags": f"Add tags: {', '.join(f'{k}={v}' for k, v in parameters.get('tags', {}).items())}",
        "enable_deletion_protection": "Enable deletion protection",
    }

    action = action_descriptions.get(action_type, action_type)

    # Extract resource type from resource_id prefix if not provided
    resource_id = item.get("resource_id", "")
    resource_type = item.get("resource_type")
    if not resource_type:
        if resource_id.startswith("i-"):
            resource_type = "EC2"
        elif resource_id.startswith("vol-"):
            resource_type = "EBS"
        elif resource_id.startswith("snap-"):
            resource_type = "EBS Snapshot"
        else:
            resource_type = "Unknown"

    # Build policy decision string
    policy_decision = f"{decision}"
    if decision == "ALLOW":
        risk = parameters.get("risk_level", "unknown")
        policy_decision = f"ALLOW ({action_type}, {risk} risk)"
    elif decision == "DENY":
        reason = item.get("error_message", "policy violation")
        policy_decision = f"DENY ({reason})"
    elif decision == "REQUIRES_APPROVAL":
        env = parameters.get("environment", "production")
        policy_decision = f"REQUIRES_APPROVAL ({action_type}, {env})"

    record = {
        "id": item.get("action_id"),
        "resourceId": resource_id,
        "resourceType": resource_type,
        "action": action,
        "status": status,
        "requestedAt": item.get("timestamp"),
        "requestedBy": item.get("user_email"),
        "policyDecision": policy_decision,
    }

    # Optional fields
    if "completed_at" in item:
        record["completedAt"] = item["completed_at"]

    if "savings" in item and status == "success":
        record["savings"] = float(item["savings"])

    return record


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for audit log queries.

    Query parameters:
    - user_email: (optional) User email to filter by. If omitted, returns all records.
    - limit: (optional) Max records to return (default: 50, max: 100)
    - lastKey: (optional) Pagination token (JSON string)

    Returns:
    - 200: List of execution records
    - 400: Invalid request
    - 500: Server error
    """
    try:
        # Extract query parameters
        params = event.get("queryStringParameters") or {}
        user_email = params.get("user_email")  # Optional now

        limit = int(params.get("limit", "50"))
        limit = min(max(limit, 1), 100)  # Clamp between 1-100

        last_key = None
        if "lastKey" in params:
            last_key = json.loads(params["lastKey"])

        # Query audit table
        result = query_user_audit_history(user_email, limit, last_key)

        # Transform records to match frontend interface
        records = [transform_audit_record(item) for item in result["items"]]

        response_body = {
            "records": records,
        }

        if "lastKey" in result:
            response_body["lastKey"] = json.dumps(result["lastKey"], cls=DecimalEncoder)

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(response_body, cls=DecimalEncoder),
        }

    except Exception as e:
        print(f"Error querying audit log: {str(e)}")
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps(
                {
                    "error": "Internal server error",
                    "message": str(e),
                }
            ),
        }

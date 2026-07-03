"""
Lambda: approval_handler
Processes approve/reject decisions from signed URLs (API Gateway).
Validates token, updates DynamoDB, invokes remediation or notifies.
"""

import json
import os
from datetime import datetime, timezone

import boto3

TABLE_NAME = os.environ.get("TABLE_NAME", "PendingApprovals")
AUDIT_TABLE_NAME = os.environ.get("AUDIT_TABLE_NAME", "RemediationAuditLog")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")
LAMBDA_PREFIX = os.environ.get("LAMBDA_PREFIX", "costopt-remediation")

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
audit_table = dynamodb.Table(AUDIT_TABLE_NAME)
lambda_client = boto3.client("lambda")
sns_client = boto3.client("sns")


def handler(event, context):
    """Process approval/rejection from signed URL click."""
    params = event.get("queryStringParameters") or {}
    token = params.get("token", "")
    decision = params.get("decision", "")

    if not token or decision not in ("approve", "reject"):
        return _html_response(400, "Invalid request. Missing token or decision.")

    # Lookup by GSI
    resp = table.query(
        IndexName="approval-token-index",
        KeyConditionExpression=boto3.dynamodb.conditions.Key("approval_token").eq(token),
    )
    items = resp.get("Items", [])
    if not items or items[0].get("status") != "PENDING":
        return _html_response(400, "Token invalid or request already processed.")

    request = items[0]
    request_id = request["request_id"]
    action_id = request.get("action_id")  # Link to audit log
    now = datetime.now(timezone.utc).isoformat()

    if decision == "approve":
        # Update approval request to APPROVED
        table.update_item(
            Key={"request_id": request_id},
            UpdateExpression="SET #s = :s, decided_at = :d",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": "APPROVED", ":d": now},
        )

        # Update audit log: REQUIRES_APPROVAL → ALLOW
        if action_id:
            _update_audit_on_approval(action_id)

        # Invoke remediation Lambda
        fn_name = f"{LAMBDA_PREFIX}-{request['action_type'].replace('_', '-')}"
        payload = {"resource_id": request["resource_id"], **(request.get("parameters") or {})}
        try:
            lambda_client.invoke(FunctionName=fn_name, InvocationType="Event", Payload=json.dumps(payload))
            table.update_item(
                Key={"request_id": request_id},
                UpdateExpression="SET #s = :s",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":s": "EXECUTED"},
            )

            # Update audit log with completion
            if action_id:
                _update_audit_on_execution(action_id, success=True)

        except Exception as e:
            table.update_item(
                Key={"request_id": request_id},
                UpdateExpression="SET execution_result = :r",
                ExpressionAttributeValues={":r": f"Error: {str(e)}"},
            )

            # Update audit log with error
            if action_id:
                _update_audit_on_execution(action_id, success=False, error=str(e))

        return _html_response(200, "Action APPROVED and execution initiated.")

    # Reject
    table.update_item(
        Key={"request_id": request_id},
        UpdateExpression="SET #s = :s, decided_at = :d",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": "DENIED", ":d": now},
    )

    # Update audit log: REQUIRES_APPROVAL → DENY
    if action_id:
        _update_audit_on_denial(action_id, reason="User rejected approval request")

    if SNS_TOPIC_ARN:
        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject="Remediation Request Denied",
            Message=f"Request {request_id} ({request['action_type']} on {request['resource_id']}) was denied.",
        )
    return _html_response(200, "Action DENIED. The requester has been notified.")


def _update_audit_on_approval(action_id: str):
    """Update audit log when user approves HITL request."""
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
            UpdateExpression="SET decision = :d",
            ExpressionAttributeValues={":d": "ALLOW"},
        )
    except Exception as e:
        print(f"Failed to update audit on approval: {e}")


def _update_audit_on_denial(action_id: str, reason: str):
    """Update audit log when user denies HITL request."""
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
            ExpressionAttributeValues={":d": "DENY", ":e": reason},
        )
    except Exception as e:
        print(f"Failed to update audit on denial: {e}")


def _update_audit_on_execution(action_id: str, success: bool, error: str = ""):
    """Update audit log after remediation execution."""
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
        completed_at = datetime.now(timezone.utc).isoformat()

        if success:
            audit_table.update_item(
                Key={"action_id": action_id, "timestamp": timestamp},
                UpdateExpression="SET completed_at = :c",
                ExpressionAttributeValues={":c": completed_at},
            )
        else:
            audit_table.update_item(
                Key={"action_id": action_id, "timestamp": timestamp},
                UpdateExpression="SET completed_at = :c, error_message = :e",
                ExpressionAttributeValues={":c": completed_at, ":e": error},
            )
    except Exception as e:
        print(f"Failed to update audit on execution: {e}")


def _html_response(status_code, message):
    """Return a simple HTML confirmation page."""
    color = "#90ee90" if status_code == 200 else "#ff6b6b"
    html = f"""<!DOCTYPE html><html><head><title>Cost Optimizer - Approval</title></head>
<body style="font-family:sans-serif;background:#1a1f26;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center;padding:40px;border:1px solid #3d4852;border-radius:12px;max-width:500px">
<h2 style="color:{color}">{message}</h2>
<p style="color:#b0b8c1">You can close this window.</p>
</div></body></html>"""
    return {"statusCode": status_code, "headers": {"Content-Type": "text/html"}, "body": html}

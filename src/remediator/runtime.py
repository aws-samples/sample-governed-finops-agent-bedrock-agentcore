"""
AgentCore Cost Optimizer - Remediator Agent Runtime (Runtime 2)

Separate Strands Agent on Amazon Bedrock AgentCore that executes
remediation actions via Lambda tools, governed by Cedar policies.
"""

import json
import logging
import os
import time
import uuid
from typing import Any, cast

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from policy_engine import AuthorizationResult, RemediatorPolicy
from prompt import build_remediator_prompt
from strands import Agent
from strands.models import BedrockModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# AgentCore app
app = BedrockAgentCoreApp()

# Configuration
MODEL_ID = os.environ.get("MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
POLICY_STORE_ID = os.environ.get("POLICY_STORE_ID", "")
LAMBDA_PREFIX = os.environ.get("LAMBDA_PREFIX", "costopt-remediation")
APPROVAL_TABLE_NAME = os.environ.get("APPROVAL_TABLE_NAME", "PendingApprovals")
APPROVAL_API_URL = os.environ.get("APPROVAL_API_URL", "")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN", "")

logger.info("Remediator Runtime - Model: %s | Region: %s", MODEL_ID, AWS_REGION)
logger.info("Policy Store: %s | Lambda Prefix: %s", POLICY_STORE_ID, LAMBDA_PREFIX)

# Bedrock model
model = BedrockModel(model_id=MODEL_ID, region_name=AWS_REGION)

# Lambda client
lambda_client = boto3.client("lambda", region_name=AWS_REGION)

# DynamoDB and SNS clients for HITL
dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
sns_client = boto3.client("sns", region_name=AWS_REGION)

# Policy engine
policy = RemediatorPolicy(policy_store_id=POLICY_STORE_ID)

# System prompt
system_prompt = build_remediator_prompt()

# Agent (no MCP tools - uses Lambda invocations)
agent = Agent(model=model, system_prompt=system_prompt)


def create_approval_request(
    action_type: str,
    resource_id: str,
    resource_context: dict,
    identity: dict,
    parameters: dict,
    action_id: str,  # Link to audit log
) -> str:
    """Create an ApprovalRequest in DynamoDB and notify approver via SNS."""
    request_id = str(uuid.uuid4())
    approval_token = str(uuid.uuid4())
    now = int(time.time())
    expires_at = now + 86400  # 24 hours

    # Get risk level from resource_context
    risk_level = resource_context.get("risk_level", "high")

    # Store in DynamoDB
    if APPROVAL_TABLE_NAME:
        approval_table = dynamodb.Table(APPROVAL_TABLE_NAME)
        approval_table.put_item(
            Item={
                "request_id": request_id,
                "approval_token": approval_token,
                "action_type": action_type,
                "resource_id": resource_id,
                "resource_environment": resource_context.get("environment", "unknown"),
                "parameters": parameters,
                "requester_email": identity.get("email", "unknown"),
                "requester_role": identity.get("role", "unknown"),
                "status": "PENDING",
                "risk_level": risk_level,
                "created_at": now,
                "expires_at": expires_at,
                "action_id": action_id,  # Link to audit log
            }
        )

    # Build signed URLs
    approve_url = f"{APPROVAL_API_URL}/approve?token={approval_token}&decision=approve"
    reject_url = f"{APPROVAL_API_URL}/reject?token={approval_token}&decision=reject"

    # Notify approver via SNS
    if SNS_TOPIC_ARN:
        message = (
            f"Solicitud de Aprobacion - Cost Optimizer\n\n"
            f"Se ha solicitado ejecutar una accion de alto riesgo que requiere su aprobacion.\n\n"
            f"Detalles:\n"
            f"  Accion: {action_type}\n"
            f"  Recurso: {resource_id}\n"
            f"  Ambiente: {resource_context.get('environment', 'desconocido')}\n"
            f"  Solicitado por: {identity.get('email', 'desconocido')} ({identity.get('role', '')})\n"
            f"  Nivel de riesgo: {risk_level}\n\n"
            f"Si desea aprobar esta accion, haga click aqui:\n"
            f"{approve_url}\n\n"
            f"De forma contraria, deniegue aqui:\n"
            f"{reject_url}\n\n"
            f"Esta solicitud expira en 24 horas."
        )
        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"[Aprobacion Requerida] {action_type} en {resource_id}",
            Message=message,
        )

    logger.info("Created approval request %s for %s on %s", request_id, action_type, resource_id)
    return request_id


def invoke_lambda_tool(action_type: str, payload: dict) -> dict[str, Any]:
    """Invoke a remediation Lambda function."""
    function_name = f"{LAMBDA_PREFIX}-{action_type.replace('_', '-')}"
    logger.info("Invoking Lambda: %s with payload: %s", function_name, json.dumps(payload))

    try:
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType="RequestResponse",
            Payload=json.dumps(payload),
        )
        result = json.loads(response["Payload"].read())
        logger.info("Lambda result: %s", json.dumps(result))
        return cast(dict[str, Any], result)
    except Exception as e:
        logger.error("Lambda invocation failed: %s", e)
        return {"success": False, "error": str(e)}


def extract_identity(jwt_token: str) -> dict:
    """Extract user identity from JWT token claims.

    In production, this would validate the JWT signature.
    For now, we decode the payload to extract role and email.
    """
    import base64

    try:
        # JWT is header.payload.signature - decode payload
        parts = jwt_token.split(".")
        if len(parts) != 3:
            return {"role": "analyst", "email": "unknown"}

        # Add padding
        payload = parts[1] + "=" * (4 - len(parts[1]) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        claims = json.loads(decoded)

        # Extract role from cognito:groups
        groups = claims.get("cognito:groups", [])
        role = "analyst"  # default to least privilege
        if "CostOpt-Manager" in groups or "manager" in groups:
            role = "manager"
        elif "CostOpt-Engineer" in groups or "engineer" in groups:
            role = "engineer"

        return {
            "role": role,
            "email": claims.get("email", "unknown"),
            "sub": claims.get("sub", ""),
            "groups": groups,
        }
    except Exception as e:
        logger.warning("Failed to decode JWT, defaulting to analyst: %s", e)
        return {"role": "analyst", "email": "unknown"}


@app.entrypoint
def invoke(payload):
    """Process a remediation request.

    Expected payload:
    {
        "action_type": "resize_instance",
        "resource_id": "i-0123456789abcdef0",
        "parameters": {"target_type": "t3.small"},
        "risk_level": "low",  // injected by interceptor, or from frontend
        "jwt_token": "eyJ..."
    }

    Flow:
    1. Cedar policies already validated role-based access at the gateway
    2. This runtime only checks if HITL is needed (high-risk)
    3. All actions are logged to audit trail
    """
    action_type = payload.get("action_type", "")
    resource_id = payload.get("resource_id", "")
    parameters = payload.get("parameters", {})
    risk_level = payload.get("risk_level", "high")  # fail-closed default
    jwt_token = payload.get("jwt_token", "")

    if not action_type or not resource_id:
        return {"error": "action_type and resource_id are required"}

    logger.info("Remediation request: %s on %s (risk: %s)", action_type, resource_id, risk_level)

    # Extract user identity from JWT
    identity = extract_identity(jwt_token)
    logger.info("User: %s (role: %s)", identity["email"], identity["role"])

    # Evaluate: does this need HITL approval?
    auth_result: AuthorizationResult = policy.authorize(
        action_type=action_type,
        risk_level=risk_level,
    )
    logger.info("Policy decision: %s - %s", auth_result.decision, auth_result.reason)

    # Log to audit trail - returns action_id for tracking
    action_id = _log_audit(action_type, resource_id, identity, risk_level, auth_result.decision, parameters)

    if auth_result.decision == "REQUIRES_APPROVAL":
        # Create approval request in DynamoDB and notify approver
        approval_id = create_approval_request(
            action_type=action_type,
            resource_id=resource_id,
            resource_context={"risk_level": risk_level},
            identity=identity,
            parameters=parameters,
            action_id=action_id,  # Pass audit log ID
        )
        return {
            "authorized": False,
            "decision": "REQUIRES_APPROVAL",
            "reason": auth_result.reason,
            "action_type": action_type,
            "resource_id": resource_id,
            "user_role": identity["role"],
            "risk_level": risk_level,
            "approval_id": approval_id,
            "action_id": action_id,  # Return action_id for frontend tracking
        }

    # Execute via Lambda tool
    lambda_payload = {"resource_id": resource_id, **parameters}
    result = invoke_lambda_tool(action_type, lambda_payload)

    # Update audit log with execution result
    if action_id:
        try:
            from datetime import datetime, timezone

            audit_table = dynamodb.Table("RemediationAuditLog")

            update_expr = "SET completed_at = :completed"
            expr_values = {":completed": datetime.now(timezone.utc).isoformat()}

            if result.get("success"):
                # Add savings if available
                if "savings" in result:
                    update_expr += ", savings = :savings"
                    expr_values[":savings"] = result["savings"]
            else:
                # Log error
                update_expr += ", error_message = :error"
                expr_values[":error"] = result.get("error", "Unknown error")

            audit_table.update_item(
                Key={"action_id": action_id, "timestamp": _get_timestamp_from_action_id(action_id)},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
            )
        except Exception as e:
            logger.warning("Failed to update audit log: %s", e)

    return {
        "authorized": True,
        "decision": "ALLOW",
        "action_type": action_type,
        "resource_id": resource_id,
        "user_role": identity["role"],
        "risk_level": risk_level,
        "execution_result": result,
        "action_id": action_id,
    }


def _log_audit(
    action_type: str,
    resource_id: str,
    identity: dict,
    risk_level: str,
    decision: str,
    parameters: dict | None = None,
) -> str:
    """Log all actions to the audit trail in DynamoDB.

    Returns the action_id (PK) for later updates.
    """
    try:
        from datetime import datetime, timezone

        action_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        audit_table = dynamodb.Table("RemediationAuditLog")

        # Determine resource_type from resource_id prefix
        resource_type = "Unknown"
        if resource_id.startswith("i-"):
            resource_type = "EC2"
        elif resource_id.startswith("vol-"):
            resource_type = "EBS"
        elif resource_id.startswith("snap-"):
            resource_type = "EBS Snapshot"
        elif resource_id.startswith("rds-"):
            resource_type = "RDS"

        item = {
            "action_id": action_id,
            "timestamp": timestamp,
            "user_id": identity.get("sub", "unknown"),
            "user_email": identity.get("email", "unknown"),
            "user_role": identity.get("role", "unknown"),
            "decision": decision,
            "action_type": action_type,
            "resource_id": resource_id,
            "resource_type": resource_type,
            "parameters": parameters or {},
        }

        audit_table.put_item(Item=item)
        logger.info("Audit log created: %s", action_id)
        return action_id

    except Exception as e:
        logger.warning("Failed to log audit: %s", e)
        return ""


def _get_timestamp_from_action_id(action_id: str) -> str:
    """Query DynamoDB to get timestamp for a given action_id (needed for update_item with composite key)."""
    try:
        audit_table = dynamodb.Table("RemediationAuditLog")
        response = audit_table.get_item(Key={"action_id": action_id})
        result: str = response.get("Item", {}).get("timestamp", "")
        return result
    except Exception:
        return ""


if __name__ == "__main__":
    logger.info("Starting Remediator Agent Runtime")
    app.run()

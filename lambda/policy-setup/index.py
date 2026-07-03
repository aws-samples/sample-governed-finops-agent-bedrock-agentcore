"""
Custom resource Lambda for AgentCore Policy Store setup.
Reads Cedar schema and policies from local files (packaged in the Lambda zip).
"""

import json
import logging
import os
import time
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

GATEWAY_ID = os.environ.get("GATEWAY_ID", "")
STORE_NAME = os.environ.get("POLICY_STORE_NAME", "costopt-policy-store")


def send_cfn_response(event, status, data=None, reason=None, physical_id=None):
    body = json.dumps(
        {
            "Status": status,
            "Reason": reason or "See CloudWatch Logs",
            "PhysicalResourceId": physical_id or event.get("PhysicalResourceId", event["RequestId"]),
            "StackId": event["StackId"],
            "RequestId": event["RequestId"],
            "LogicalResourceId": event["LogicalResourceId"],
            "Data": data or {},
        }
    )
    req = urllib.request.Request(
        event["ResponseURL"],
        data=body.encode("utf-8"),
        headers={"Content-Type": ""},
        method="PUT",
    )
    urllib.request.urlopen(req)  # nosec B310 - CloudFormation custom resource response URL


def load_cedar_files():
    """Load schema and policies from local cedar/ directory."""
    cedar_dir = os.path.join(os.path.dirname(__file__), "cedar")
    schema = ""
    policies = {}

    schema_path = os.path.join(cedar_dir, "schema.cedarschema")
    if os.path.exists(schema_path):
        with open(schema_path) as f:
            schema = f.read()

    policies_dir = os.path.join(cedar_dir, "policies")
    if os.path.isdir(policies_dir):
        for fname in os.listdir(policies_dir):
            if fname.endswith(".cedar"):
                name = fname.replace(".cedar", "")
                with open(os.path.join(policies_dir, fname)) as f:
                    policies[name] = f.read()

    return schema, policies


def handler(event, context):
    logger.info("Event: %s", json.dumps(event))
    props = event["ResourceProperties"]
    region = props.get("Region", "us-east-1")

    cedar_schema, cedar_policies = load_cedar_files()
    logger.info("Loaded schema (%d chars) and %d policies", len(cedar_schema), len(cedar_policies))

    try:
        client = boto3.client("bedrock-agentcore-control", region_name=region)
    except Exception as e:
        logger.warning("AgentCore control client not available: %s", e)
        send_cfn_response(
            event,
            "SUCCESS",
            data={
                "PolicyStoreId": f"{STORE_NAME}-placeholder",
            },
            physical_id=f"{STORE_NAME}-placeholder",
        )
        return

    if event["RequestType"] == "Delete":
        physical_id = event.get("PhysicalResourceId", "")
        if physical_id and not physical_id.endswith("-placeholder"):
            try:
                client.delete_policy_store(policyStoreId=physical_id)
                logger.info("Deleted Policy Store: %s", physical_id)
            except Exception as e:
                logger.warning("Cleanup error: %s", e)
        send_cfn_response(event, "SUCCESS")
        return

    try:
        if event["RequestType"] == "Create":
            resp = client.create_policy_store(
                name=STORE_NAME,
                validationSettings={"mode": "STRICT"},
            )
            store_id = resp["policyStoreId"]
        else:
            store_id = event.get("PhysicalResourceId", "")

        time.sleep(3)

        if cedar_schema:
            client.put_schema(policyStoreId=store_id, definition={"cedarJson": cedar_schema})
            logger.info("Schema deployed")

        if event["RequestType"] == "Update":
            try:
                existing = client.list_policies(policyStoreId=store_id)
                for pol in existing.get("policies", []):
                    client.delete_policy(policyStoreId=store_id, policyId=pol["policyId"])
            except Exception:
                pass

        for name, code in cedar_policies.items():
            client.create_policy(
                policyStoreId=store_id,
                name=f"costopt-{name}",
                definition={"static": {"statement": code}},
            )
            logger.info("Created policy: costopt-%s", name)

        send_cfn_response(event, "SUCCESS", data={"PolicyStoreId": store_id}, physical_id=store_id)

    except Exception as e:
        logger.error("Error: %s", e)
        send_cfn_response(event, "FAILED", reason=str(e))

"""CloudFormation Custom Resource handler that starts a CodeBuild build."""

import json
import logging
import urllib.request

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

codebuild = boto3.client("codebuild")


def send_response(event, status, data=None, reason=None, physical_id=None):
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


def handler(event, context):
    logger.info(f"Event: {json.dumps(event)}")
    request_type = event["RequestType"]

    if request_type == "Delete":
        send_response(event, "SUCCESS")
        return

    try:
        project_name = event["ResourceProperties"]["ProjectName"]
        response = codebuild.start_build(projectName=project_name)
        build_id = response["build"]["id"]
        logger.info(f"Started build: {build_id}")
        send_response(event, "SUCCESS", data={"BuildId": build_id}, physical_id=build_id)
    except Exception as e:
        logger.error(f"Failed to start build: {e}")
        send_response(event, "FAILED", reason=str(e))

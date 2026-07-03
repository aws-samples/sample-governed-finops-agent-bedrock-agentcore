"""CloudFormation Custom Resource handler that polls CodeBuild build status."""

import json
import logging
import time
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
        build_id = event["ResourceProperties"]["BuildId"]
        max_wait = int(event["ResourceProperties"].get("MaxWaitSeconds", "1200"))
        poll_interval = 15
        elapsed = 0

        while elapsed < max_wait:
            response = codebuild.batch_get_builds(ids=[build_id])
            builds = response.get("builds", [])
            if not builds:
                raise Exception(f"Build {build_id} not found")

            build_status = builds[0]["buildStatus"]
            logger.info(f"Build {build_id} status: {build_status} (elapsed: {elapsed}s)")

            if build_status == "SUCCEEDED":
                send_response(event, "SUCCESS", data={"BuildStatus": "SUCCEEDED"}, physical_id=build_id)
                return
            elif build_status in ("FAILED", "FAULT", "STOPPED", "TIMED_OUT"):
                send_response(event, "FAILED", reason=f"Build {build_status}", physical_id=build_id)
                return

            time.sleep(poll_interval)
            elapsed += poll_interval

        send_response(event, "FAILED", reason=f"Build timed out after {max_wait}s", physical_id=build_id)
    except Exception as e:
        logger.error(f"Error polling build: {e}")
        send_response(event, "FAILED", reason=str(e))

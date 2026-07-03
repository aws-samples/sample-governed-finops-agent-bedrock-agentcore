"""Shared test configuration and fixtures."""

import os

# Ensure test environment variables are set
os.environ.setdefault("AWS_ACCOUNT_ID", "123456789012")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("TABLE_NAME", "TestApprovalRequests")
os.environ.setdefault("SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:123456789012:test-topic")
os.environ.setdefault("RISK_MAPPING_TABLE_NAME", "TestRiskMappings")

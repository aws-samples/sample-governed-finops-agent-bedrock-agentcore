#!/usr/bin/env python3
"""
Seed script for the CostOptRiskMappings DynamoDB table.

Populates the 7 initial action-to-risk-level mappings used by the
Risk Level Interceptor and Policy Engine Module.

Usage:
    python seed_risk_mappings.py [--table-name TABLE_NAME]

Environment Variables:
    RISK_MAPPING_TABLE_NAME: DynamoDB table name (default: CostOptRiskMappings)
"""

import argparse
import os
import sys

import boto3
from botocore.exceptions import ClientError

# Initial risk mappings: action key -> (target, riskLevel)
RISK_MAPPINGS = [
    {"action": "resize___resize_instance", "target": "resize_instance", "riskLevel": "low"},
    {"action": "storage___modify_storage", "target": "modify_storage", "riskLevel": "low"},
    {"action": "tag___add_tag", "target": "add_tag", "riskLevel": "low"},
    {"action": "stop___stop_instance", "target": "stop_instance", "riskLevel": "medium"},
    {"action": "snapshot___delete_snapshot", "target": "delete_snapshot", "riskLevel": "medium"},
    {"action": "terminate___terminate_instance", "target": "terminate_instance", "riskLevel": "high"},
    {"action": "volume___delete_ebs_volume", "target": "delete_ebs_volume", "riskLevel": "high"},
]


def seed_table(table_name: str) -> None:
    """Populate the Risk Mapping Table with initial records.

    Uses put_item for idempotency - existing records are overwritten
    with the same values, making this script safe to run multiple times.
    """
    dynamodb = boto3.resource("dynamodb")
    table = dynamodb.Table(table_name)

    print(f"Seeding table: {table_name}")
    print(f"Records to write: {len(RISK_MAPPINGS)}")
    print("-" * 50)

    success_count = 0
    for mapping in RISK_MAPPINGS:
        try:
            table.put_item(Item=mapping)
            print(f"  [OK] {mapping['action']} -> {mapping['riskLevel']}")
            success_count += 1
        except ClientError as e:
            print(f"  [ERROR] {mapping['action']}: {e.response['Error']['Message']}")

    print("-" * 50)
    print(f"Completed: {success_count}/{len(RISK_MAPPINGS)} records written successfully.")

    if success_count < len(RISK_MAPPINGS):
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Seed the CostOptRiskMappings DynamoDB table with initial risk level mappings."
    )
    parser.add_argument(
        "--table-name",
        default=os.environ.get("RISK_MAPPING_TABLE_NAME", "CostOptRiskMappings"),
        help="DynamoDB table name (default: env RISK_MAPPING_TABLE_NAME or CostOptRiskMappings)",
    )
    args = parser.parse_args()

    seed_table(args.table_name)


if __name__ == "__main__":
    main()

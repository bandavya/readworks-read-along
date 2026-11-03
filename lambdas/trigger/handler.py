"""Starts a Step Functions execution when a passage JSON lands in S3.

Section 4.2 step 2: an operator or test event starts generation when mock
content changes (S3 notification on passages/*.json).
"""
import json
import os
import urllib.parse

import boto3

sfn = boto3.client("stepfunctions")
STATE_MACHINE_ARN = os.environ["STATE_MACHINE_ARN"]


def start_from_s3(event, _context):
    started = []
    for record in event.get("Records", []):
        bucket = record["s3"]["bucket"]["name"]
        key = urllib.parse.unquote_plus(record["s3"]["object"]["key"])
        # passages/<passageId>.json
        passage_id = key.split("/")[-1].removesuffix(".json")
        resp = sfn.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps({"passageId": passage_id, "key": key, "bucket": bucket}),
        )
        started.append(resp["executionArn"])
    return {"started": started}

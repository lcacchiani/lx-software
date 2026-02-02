"""Lambda handler to bootstrap Cognito admin users."""

from __future__ import annotations

from typing import Any, Mapping

import boto3
from botocore.exceptions import ClientError

from app.utils.cfn_response import send_cfn_response
from app.utils.logging import configure_logging, get_logger
from app.utils.logging import hash_for_correlation, mask_email

configure_logging()
logger = get_logger(__name__)


def lambda_handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Handle CloudFormation custom resource events for admin bootstrap."""

    request_type = str(event.get("RequestType", ""))
    physical_id = str(event.get("PhysicalResourceId") or "admin-bootstrap")

    if request_type == "Delete":
        logger.info("Delete request received, skipping admin bootstrap")
        data = {"status": "skipped"}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}

    try:
        properties = event.get("ResourceProperties") or {}
        user_pool_id = _require_value(properties, "UserPoolId")
        email = _normalize_email(_require_value(properties, "Email"))
        temp_password = _require_value(properties, "TempPassword")
        group_name = _require_value(properties, "GroupName")

        user_ref = hash_for_correlation(f"{user_pool_id}:{email}")
        masked_email = mask_email(email)
        logger.info(
            "Handling admin bootstrap request",
            extra={
                "request_type": request_type,
                "user_pool_id": user_pool_id,
                "user": masked_email,
                "user_ref": user_ref,
            },
        )

        physical_id = str(
            event.get("PhysicalResourceId") or f"admin-bootstrap-{user_ref}"
        )
        if request_type not in {"Create", "Update"}:
            raise ValueError("Unsupported request type")

        client = boto3.client("cognito-idp")
        _create_or_update_user(
            client,
            user_pool_id,
            email,
            temp_password,
            masked_email,
            user_ref,
        )
        _set_user_password(
            client,
            user_pool_id,
            email,
            temp_password,
            masked_email,
            user_ref,
        )
        _add_user_to_group(
            client,
            user_pool_id,
            email,
            group_name,
            masked_email,
            user_ref,
        )

        data = {"status": "ok"}
        send_cfn_response(event, context, "SUCCESS", data, physical_id)
        return {"PhysicalResourceId": physical_id, "Data": data}
    except Exception:
        logger.error(
            "Admin bootstrap failed",
            extra={"request_type": request_type},
            exc_info=True,
        )
        data = {"status": "failed"}
        send_cfn_response(
            event,
            context,
            "FAILED",
            data,
            physical_id,
            "Admin bootstrap failed",
        )
        return {"PhysicalResourceId": physical_id, "Data": data}


def _create_or_update_user(
    client: Any,
    user_pool_id: str,
    email: str,
    temp_password: str,
    masked_email: str,
    user_ref: str,
) -> None:
    try:
        client.admin_create_user(
            UserPoolId=user_pool_id,
            Username=email,
            TemporaryPassword=temp_password,
            MessageAction="SUPPRESS",
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
        )
        logger.info(
            "Admin user created",
            extra={"user": masked_email, "user_ref": user_ref},
        )
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code")
        if error_code != "UsernameExistsException":
            logger.error(
                "Failed to create admin user",
                extra={"user": masked_email, "user_ref": user_ref},
                exc_info=True,
            )
            raise
        client.admin_update_user_attributes(
            UserPoolId=user_pool_id,
            Username=email,
            UserAttributes=[
                {"Name": "email", "Value": email},
                {"Name": "email_verified", "Value": "true"},
            ],
        )
        logger.info(
            "Admin user attributes updated",
            extra={"user": masked_email, "user_ref": user_ref},
        )


def _set_user_password(
    client: Any,
    user_pool_id: str,
    email: str,
    temp_password: str,
    masked_email: str,
    user_ref: str,
) -> None:
    client.admin_set_user_password(
        UserPoolId=user_pool_id,
        Username=email,
        Password=temp_password,
        Permanent=True,
    )
    logger.info(
        "Admin user password set",
        extra={"user": masked_email, "user_ref": user_ref},
    )


def _add_user_to_group(
    client: Any,
    user_pool_id: str,
    email: str,
    group_name: str,
    masked_email: str,
    user_ref: str,
) -> None:
    client.admin_add_user_to_group(
        UserPoolId=user_pool_id,
        Username=email,
        GroupName=group_name,
    )
    logger.info(
        "Admin user added to group",
        extra={
            "user": masked_email,
            "user_ref": user_ref,
            "group": group_name,
        },
    )


def _require_value(properties: Mapping[str, Any], key: str) -> str:
    value = properties.get(key)
    if value is None:
        raise ValueError("Missing required property")
    if isinstance(value, str):
        value = value.strip()
    if not value:
        raise ValueError("Missing required property")
    return str(value)


def _normalize_email(value: str) -> str:
    return value.strip().lower()

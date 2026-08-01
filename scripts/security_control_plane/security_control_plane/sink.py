from __future__ import annotations

import os
from typing import Any

from .models import EnterpriseSecurityReport


def write_report_to_firestore(report: EnterpriseSecurityReport) -> None:
    project_id = (
        os.environ.get("MYSC_SECURITY_FIRESTORE_PROJECT_ID")
        or os.environ.get("FIREBASE_PROJECT_ID")
    )
    if not project_id:
        raise RuntimeError("MYSC_SECURITY_FIRESTORE_PROJECT_ID or FIREBASE_PROJECT_ID is required")
    from firebase_admin import firestore

    org_id = os.environ.get("MYSC_SECURITY_ORG_ID") or "mysc"
    app = _get_or_init_app(project_id)
    client = firestore.client(app=app)
    root = client.collection("orgs").document(org_id)

    root.collection("securityMonitoringRuns").document(report.run_id).set(
        report.model_dump(by_alias=True, exclude={"findings", "assets"}),
        merge=True,
    )

    batch = client.batch()
    pending = 0

    def flush_if_needed(force: bool = False) -> None:
        nonlocal batch, pending
        if pending == 0 or (not force and pending < 450):
            return
        batch.commit()
        batch = client.batch()
        pending = 0

    for finding in report.findings:
        ref = root.collection("securityFindings").document(finding.id)
        batch.set(ref, {**finding.model_dump(by_alias=True), "runId": report.run_id}, merge=True)
        pending += 1
        flush_if_needed()

    for asset in report.assets:
        ref = root.collection("securityAssets").document(f"{asset.source}:{asset.asset_id_hash}")
        batch.set(ref, {**asset.model_dump(by_alias=True), "runId": report.run_id}, merge=True)
        pending += 1
        flush_if_needed()

    flush_if_needed(force=True)


def _get_or_init_app(project_id: str) -> firebase_admin.App:
    import firebase_admin
    from firebase_admin import credentials

    app_name = f"security-control-plane-sink-{project_id}"
    try:
        return firebase_admin.get_app(app_name)
    except ValueError:
        pass

    service_account_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") or os.environ.get(
        "FIREBASE_SERVICE_ACCOUNT_JSON"
    )
    if service_account_json:
        import json

        info: Any = json.loads(service_account_json)
        if isinstance(info.get("private_key"), str):
            info["private_key"] = info["private_key"].replace("\\n", "\n")
        cred = credentials.Certificate(info)
    else:
        cred = credentials.ApplicationDefault()
    return firebase_admin.initialize_app(cred, {"projectId": project_id}, name=app_name)

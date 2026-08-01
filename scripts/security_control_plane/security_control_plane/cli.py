from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List

from .models import EnterpriseSecurityReport, FindingSummary, SecurityAsset, SecurityFinding
from .rules import summarize_findings
from .scanners import scan_drive_shared_drives, scan_firestore_projects, scan_github_org, split_csv
from .sink import write_report_to_firestore


DEFAULT_FIREBASE_PROJECTS = [
    "inner-platform-live-20260316",
    "startup-acceleration-platform",
    "startup-diagnosis-platform",
    "submit-mysc-20260507",
    "yapnotes-app-2",
]
DEFAULT_COMPANY_DOMAINS = ["mysc.co.kr"]


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan MYSC enterprise GitHub, Firestore and Drive security posture.")
    parser.add_argument("--github-org", default=os.environ.get("MYSC_SECURITY_GITHUB_ORG", "merryAI-dev"))
    parser.add_argument(
        "--firebase-projects",
        default=os.environ.get("MYSC_SECURITY_FIREBASE_PROJECTS", ",".join(DEFAULT_FIREBASE_PROJECTS)),
    )
    parser.add_argument(
        "--company-domains",
        default=os.environ.get("MYSC_SECURITY_COMPANY_DOMAINS", ",".join(DEFAULT_COMPANY_DOMAINS)),
    )
    parser.add_argument("--skip", default="", help="Comma-separated sources to skip: github,firestore,drive")
    parser.add_argument("--drive-file-limit", type=int, default=500)
    parser.add_argument("--output", default="")
    parser.add_argument("--write-firestore", action="store_true")
    return parser.parse_args(list(argv) if argv is not None else None)


def build_report(args: argparse.Namespace) -> EnterpriseSecurityReport:
    started_at = datetime.now(timezone.utc).isoformat()
    run_id = f"enterprise-security-{started_at.replace(':', '-').replace('.', '-')}"
    skip = {item.strip() for item in str(args.skip).split(",") if item.strip()}
    firebase_projects = split_csv(args.firebase_projects, DEFAULT_FIREBASE_PROJECTS)
    company_domains = split_csv(args.company_domains, DEFAULT_COMPANY_DOMAINS)

    findings: List[SecurityFinding] = []
    assets: List[SecurityAsset] = []
    errors: List[str] = []

    if "github" not in skip:
        github_section = scan_github_org(args.github_org)
        findings.extend(github_section.findings)
        assets.extend(github_section.assets)
        errors.extend(github_section.errors)

    if "firestore" not in skip:
        firestore_section = scan_firestore_projects(firebase_projects)
        findings.extend(firestore_section.findings)
        assets.extend(firestore_section.assets)
        errors.extend(firestore_section.errors)

    if "drive" not in skip:
        drive_section = scan_drive_shared_drives(company_domains, max_files_per_drive=args.drive_file_limit)
        findings.extend(drive_section.findings)
        assets.extend(drive_section.assets)
        errors.extend(drive_section.errors)

    summary = FindingSummary.model_validate(summarize_findings(findings))
    return EnterpriseSecurityReport(
        runId=run_id,
        startedAt=started_at,
        completedAt=datetime.now(timezone.utc).isoformat(),
        scope={
            "githubOrg": None if "github" in skip else args.github_org,
            "firebaseProjects": [] if "firestore" in skip else firebase_projects,
            "driveMode": "skipped" if "drive" in skip else "shared_drives",
        },
        summary=summary,
        assetCount=len(assets),
        errorCount=len(errors),
        errors=errors,
        findings=findings,
        assets=assets,
    )


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    report = build_report(args)
    payload = report.model_dump(by_alias=True)

    if args.output:
        Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.write_firestore:
        write_report_to_firestore(report)

    print(
        json.dumps(
            {
                "runId": report.run_id,
                "summary": report.summary.model_dump(by_alias=True),
                "assetCount": report.asset_count,
                "errorCount": report.error_count,
                "errors": report.errors[:10],
                "output": args.output or None,
                "wroteToFirestore": bool(args.write_firestore),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

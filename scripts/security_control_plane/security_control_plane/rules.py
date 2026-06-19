from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from .models import (
    DriveFileAsset,
    FirestoreCollectionAsset,
    GitHubRepositoryAsset,
    RiskLevel,
    SecurityFinding,
    SecuritySource,
)


SENSITIVE_COLLECTION_PATTERNS = (
    "user",
    "member",
    "profile",
    "auth",
    "pii",
    "payroll",
    "salary",
    "settlement",
    "transaction",
    "evidence",
    "document",
    "audit",
    "report",
)

DRIVE_SENSITIVE_NAME_PATTERNS = (
    "계약",
    "급여",
    "정산",
    "인사",
    "개인정보",
    "신분증",
    "통장",
    "사업자등록",
    "재무",
    "투자",
    "contract",
    "payroll",
    "salary",
    "pii",
    "privacy",
    "confidential",
    "passport",
    "id card",
    "id_card",
)


def stable_hash(value: Any, length: int = 24) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:length]


def normalize_email_domain(email: Optional[str]) -> str:
    value = str(email or "").strip().lower()
    if "@" not in value:
        return ""
    return value.rsplit("@", 1)[1]


def is_company_email(email: Optional[str], company_domains: Iterable[str]) -> bool:
    domain = normalize_email_domain(email)
    return bool(domain and domain in {item.lower() for item in company_domains})


def _finding(
    *,
    source: SecuritySource,
    scope_id: str,
    resource_id: str,
    rule_id: str,
    risk_level: RiskLevel,
    title: str,
    reasons: List[str],
    metadata: Optional[Dict[str, Any]] = None,
) -> SecurityFinding:
    return SecurityFinding(
        id=f"{source.value}:{scope_id}:{rule_id}:{stable_hash(resource_id, 20)}",
        source=source,
        scopeId=scope_id,
        resourceIdHash=stable_hash(resource_id),
        ruleId=rule_id,
        riskLevel=risk_level,
        title=title,
        reasons=[reason for reason in reasons if reason][:8],
        metadata=metadata or {},
        status="open",
    )


def evaluate_github_repository(repo: GitHubRepositoryAsset) -> List[SecurityFinding]:
    findings: List[SecurityFinding] = []
    resource_id = repo.name_with_owner

    if repo.visibility.upper() != "PRIVATE":
        findings.append(
            _finding(
                source=SecuritySource.GITHUB,
                scope_id=repo.owner,
                resource_id=resource_id,
                rule_id="github_repo_not_private",
                risk_level=RiskLevel.MEDIUM if repo.is_fork else RiskLevel.HIGH,
                title="GitHub repository is not private",
                reasons=["전사 repo는 기본 private이어야 합니다."],
                metadata={"visibility": repo.visibility, "isFork": repo.is_fork},
            )
        )

    if repo.default_branch_protected is False:
        findings.append(
            _finding(
                source=SecuritySource.GITHUB,
                scope_id=repo.owner,
                resource_id=resource_id,
                rule_id="github_default_branch_unprotected",
                risk_level=RiskLevel.HIGH,
                title="Default branch is not protected",
                reasons=["main/master force push, delete, unchecked merge를 차단해야 합니다."],
                metadata={"defaultBranch": repo.default_branch or ""},
            )
        )

    if repo.secret_scanning_status == "disabled":
        findings.append(
            _finding(
                source=SecuritySource.GITHUB,
                scope_id=repo.owner,
                resource_id=resource_id,
                rule_id="github_secret_scanning_disabled",
                risk_level=RiskLevel.HIGH,
                title="GitHub secret scanning is disabled",
                reasons=["Enterprise repo는 secret scanning을 켜야 합니다."],
            )
        )

    if repo.dependabot_security_updates_status == "disabled":
        findings.append(
            _finding(
                source=SecuritySource.GITHUB,
                scope_id=repo.owner,
                resource_id=resource_id,
                rule_id="github_dependabot_security_updates_disabled",
                risk_level=RiskLevel.MEDIUM,
                title="Dependabot security updates are disabled",
                reasons=["취약 의존성 자동 PR 또는 대체 알림 체계가 필요합니다."],
            )
        )

    if repo.pushed_at and not repo.is_archived:
        pushed_at = datetime.fromisoformat(repo.pushed_at.replace("Z", "+00:00"))
        days_since_push = (datetime.now(timezone.utc) - pushed_at).days
        if days_since_push >= 180:
            findings.append(
                _finding(
                    source=SecuritySource.GITHUB,
                    scope_id=repo.owner,
                    resource_id=resource_id,
                    rule_id="github_active_repo_stale",
                    risk_level=RiskLevel.LOW,
                    title="Active GitHub repository has no recent push",
                    reasons=["장기 미변경 repo는 소유자와 보존 필요성을 재확인해야 합니다."],
                    metadata={"daysSincePush": days_since_push},
                )
            )

    return findings


def evaluate_firestore_collection(asset: FirestoreCollectionAsset) -> List[SecurityFinding]:
    if not asset.can_read:
        return [
            _finding(
                source=SecuritySource.FIRESTORE,
                scope_id=asset.project_id,
                resource_id=f"{asset.project_id}/{asset.collection_id}",
                rule_id="firestore_collection_unscannable",
                risk_level=RiskLevel.HIGH,
                title="Firestore collection could not be scanned",
                reasons=["관제 계정이 컬렉션을 읽지 못했습니다. 권한 또는 프로젝트 연결을 확인해야 합니다."],
                metadata={"collectionId": asset.collection_id},
            )
        ]

    findings: List[SecurityFinding] = []
    lowered = asset.collection_id.lower()
    is_sensitive = any(pattern in lowered for pattern in SENSITIVE_COLLECTION_PATTERNS)

    if is_sensitive and asset.document_count > 0:
        findings.append(
            _finding(
                source=SecuritySource.FIRESTORE,
                scope_id=asset.project_id,
                resource_id=f"{asset.project_id}/{asset.collection_id}",
                rule_id="firestore_sensitive_collection_present",
                risk_level=RiskLevel.MEDIUM,
                title="Sensitive Firestore collection exists",
                reasons=["민감 가능성이 높은 컬렉션은 보안 룰, 백업, 감사 로그 확인 대상입니다."],
                metadata={
                    "collectionId": asset.collection_id,
                    "documentCount": asset.document_count,
                    "sampleSize": asset.sample_size,
                },
            )
        )

    if asset.document_count >= 100_000:
        findings.append(
            _finding(
                source=SecuritySource.FIRESTORE,
                scope_id=asset.project_id,
                resource_id=f"{asset.project_id}/{asset.collection_id}",
                rule_id="firestore_large_collection",
                risk_level=RiskLevel.LOW,
                title="Large Firestore collection requires retention review",
                reasons=["대량 컬렉션은 보관 기간, 비용, 접근 패턴을 점검해야 합니다."],
                metadata={"collectionId": asset.collection_id, "documentCount": asset.document_count},
            )
        )

    return findings


def evaluate_drive_file(file: DriveFileAsset, company_domains: Iterable[str]) -> List[SecurityFinding]:
    findings: List[SecurityFinding] = []
    lowered_name = file.file_name.lower()
    is_sensitive_name = any(pattern in lowered_name for pattern in DRIVE_SENSITIVE_NAME_PATTERNS)
    normalized_domains = {domain.lower() for domain in company_domains}
    external_permissions = []

    for permission in file.permissions:
        if permission.type == "anyone":
            external_permissions.append(permission)
        elif permission.type == "domain" and (permission.domain or "").lower() not in normalized_domains:
            external_permissions.append(permission)
        elif permission.email_address and not is_company_email(permission.email_address, normalized_domains):
            external_permissions.append(permission)

    external_writers = [
        permission
        for permission in external_permissions
        if permission.role in {"writer", "organizer", "fileOrganizer"}
    ]

    if external_permissions:
        findings.append(
            _finding(
                source=SecuritySource.DRIVE,
                scope_id=file.drive_id,
                resource_id=file.file_id,
                rule_id="drive_sensitive_file_shared_external" if is_sensitive_name else "drive_file_shared_external",
                risk_level=RiskLevel.HIGH if is_sensitive_name else RiskLevel.MEDIUM,
                title="Sensitive Drive file is externally shared" if is_sensitive_name else "Drive file is externally shared",
                reasons=[
                    "외부 계정 또는 anyone/domain 공유가 존재합니다.",
                    "파일명이 민감 문서 패턴과 일치합니다." if is_sensitive_name else "",
                ],
                metadata={
                    "driveName": file.drive_name,
                    "mimeType": file.mime_type,
                    "externalPermissionCount": len(external_permissions),
                    "externalPermissionHashes": [
                        stable_hash(permission.email_address or permission.domain or permission.type)
                        for permission in external_permissions[:20]
                    ],
                },
            )
        )

    if external_writers:
        findings.append(
            _finding(
                source=SecuritySource.DRIVE,
                scope_id=file.drive_id,
                resource_id=file.file_id,
                rule_id="drive_external_writer",
                risk_level=RiskLevel.HIGH,
                title="External Drive principal has write access",
                reasons=["외부 계정에 writer/organizer 권한이 있습니다."],
                metadata={"driveName": file.drive_name, "externalWriterCount": len(external_writers)},
            )
        )

    if file.copy_requires_writer_permission is False and is_sensitive_name:
        findings.append(
            _finding(
                source=SecuritySource.DRIVE,
                scope_id=file.drive_id,
                resource_id=file.file_id,
                rule_id="drive_sensitive_file_copy_allowed",
                risk_level=RiskLevel.MEDIUM,
                title="Sensitive Drive file can be copied by readers",
                reasons=["민감 문서 후보에 대해 copy/download 제한을 검토해야 합니다."],
                metadata={"driveName": file.drive_name},
            )
        )

    return findings


def summarize_findings(findings: List[SecurityFinding]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "total": len(findings),
        "critical": 0,
        "high": 0,
        "medium": 0,
        "low": 0,
        "info": 0,
        "bySource": {},
    }
    for finding in findings:
        risk = str(finding.risk_level)
        source = str(finding.source)
        summary[risk] += 1
        summary["bySource"][source] = summary["bySource"].get(source, 0) + 1
    return summary

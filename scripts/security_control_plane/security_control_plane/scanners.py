from __future__ import annotations

import os
import subprocess
from typing import Any, Dict, Iterable, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from github import Github
from google.oauth2.credentials import Credentials as OAuthCredentials
from google.oauth2.service_account import Credentials as ServiceAccountCredentials
from googleapiclient.discovery import build

from .models import (
    DriveFileAsset,
    DrivePermissionPrincipal,
    FirestoreCollectionAsset,
    GitHubRepositoryAsset,
    SecurityAsset,
    SecurityScanSection,
    SecuritySource,
)
from .rules import evaluate_drive_file, evaluate_firestore_collection, evaluate_github_repository, stable_hash


DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly"


def split_csv(value: Optional[str], fallback: Iterable[str]) -> List[str]:
    items = [item.strip() for item in str(value or "").split(",") if item.strip()]
    return items or list(fallback)


def scan_github_org(org_name: str, token: Optional[str] = None) -> SecurityScanSection:
    section = SecurityScanSection()
    resolved_token = token or os.environ.get("GITHUB_TOKEN") or _read_gh_cli_token()
    if not resolved_token:
        section.errors.append("GITHUB_TOKEN is required for GitHub org scan")
        return section

    github = Github(resolved_token, per_page=100)
    repos = _get_github_repositories(github, org_name)
    for repo in repos:
        default_branch_protected: Optional[bool] = None
        if repo.default_branch:
            try:
                branch = repo.get_branch(repo.default_branch)
                default_branch_protected = bool(branch.protected)
            except Exception as error:  # PyGithub maps several branch/protection failures.
                default_branch_protected = False
                section.errors.append(f"github:{repo.full_name}: branch protection check failed: {error}")

        security_and_analysis = getattr(repo, "security_and_analysis", None) or {}
        asset = GitHubRepositoryAsset(
            owner=org_name,
            name=repo.name,
            nameWithOwner=repo.full_name,
            visibility=str(getattr(repo, "visibility", "") or "unknown").upper(),
            isFork=bool(repo.fork),
            isArchived=bool(repo.archived),
            pushedAt=repo.pushed_at.isoformat() if repo.pushed_at else None,
            updatedAt=repo.updated_at.isoformat() if repo.updated_at else None,
            defaultBranch=repo.default_branch,
            defaultBranchProtected=default_branch_protected,
            secretScanningStatus=_security_feature_status(security_and_analysis, "secret_scanning"),
            dependabotSecurityUpdatesStatus=_security_feature_status(
                security_and_analysis,
                "dependabot_security_updates",
            ),
            url=repo.html_url,
        )
        section.assets.append(
            SecurityAsset(
                source=SecuritySource.GITHUB,
                scopeId=org_name,
                assetType="repository",
                assetIdHash=stable_hash(repo.full_name),
                displayName=repo.full_name,
                metadata={
                    "visibility": asset.visibility,
                    "isFork": asset.is_fork,
                    "isArchived": asset.is_archived,
                    "defaultBranch": asset.default_branch or "",
                    "defaultBranchProtected": asset.default_branch_protected,
                },
            )
        )
        section.findings.extend(evaluate_github_repository(asset))

    return section


def _get_github_repositories(github: Github, namespace: str) -> Any:
    try:
        return github.get_organization(namespace).get_repos(type="all")
    except Exception:
        authenticated_user = github.get_user()
        if authenticated_user.login.lower() == namespace.lower():
            return authenticated_user.get_repos(visibility="all")
        return github.get_user(namespace).get_repos(type="all")


def _read_gh_cli_token() -> str:
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except Exception:
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def _security_feature_status(security_and_analysis: Any, key: str) -> Optional[str]:
    if isinstance(security_and_analysis, dict):
        value = security_and_analysis.get(key)
        if isinstance(value, dict):
            return value.get("status")
    return None


def scan_firestore_projects(project_ids: Iterable[str], sample_size: int = 25) -> SecurityScanSection:
    section = SecurityScanSection()
    for project_id in project_ids:
        section_for_project = _scan_firestore_project(project_id, sample_size)
        section.assets.extend(section_for_project.assets)
        section.findings.extend(section_for_project.findings)
        section.errors.extend(section_for_project.errors)
    return section


def _scan_firestore_project(project_id: str, sample_size: int) -> SecurityScanSection:
    section = SecurityScanSection()
    try:
        app = _get_or_init_firebase_app(project_id)
        client = firestore.client(app=app)
        for collection_ref in client.collections():
            try:
                sample = list(collection_ref.limit(sample_size).stream())
                document_count = _count_collection(collection_ref, fallback=len(sample))
                collection_asset = FirestoreCollectionAsset(
                    projectId=project_id,
                    collectionId=collection_ref.id,
                    documentCount=document_count,
                    sampleSize=len(sample),
                    canRead=True,
                )
                section.assets.append(
                    SecurityAsset(
                        source=SecuritySource.FIRESTORE,
                        scopeId=project_id,
                        assetType="collection",
                        assetIdHash=stable_hash(f"{project_id}/{collection_ref.id}"),
                        displayName=collection_ref.id,
                        metadata={
                            "documentCount": document_count,
                            "sampleSize": len(sample),
                        },
                    )
                )
                section.findings.extend(evaluate_firestore_collection(collection_asset))
            except Exception as error:
                collection_asset = FirestoreCollectionAsset(
                    projectId=project_id,
                    collectionId=collection_ref.id,
                    documentCount=0,
                    sampleSize=0,
                    canRead=False,
                )
                section.findings.extend(evaluate_firestore_collection(collection_asset))
                section.errors.append(f"firestore:{project_id}/{collection_ref.id}: {error}")
    except Exception as error:
        section.errors.append(f"firestore:{project_id}: {error}")
    return section


def _get_or_init_firebase_app(project_id: str) -> firebase_admin.App:
    app_name = f"security-control-plane-{project_id}"
    try:
        return firebase_admin.get_app(app_name)
    except ValueError:
        pass

    service_account_json = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") or os.environ.get(
        "FIREBASE_SERVICE_ACCOUNT_JSON"
    )
    if service_account_json:
        import json

        info = json.loads(service_account_json)
        if isinstance(info.get("private_key"), str):
            info["private_key"] = info["private_key"].replace("\\n", "\n")
        cred = credentials.Certificate(info)
    else:
        cred = credentials.ApplicationDefault()
    return firebase_admin.initialize_app(cred, {"projectId": project_id}, name=app_name)


def _count_collection(collection_ref: Any, fallback: int) -> int:
    try:
        aggregate_query = collection_ref.count()
        results = list(aggregate_query.get())
        if results:
            return int(results[0][0].value)
    except Exception:
        return fallback
    return fallback


def scan_drive_shared_drives(
    company_domains: Iterable[str],
    max_files_per_drive: int = 500,
) -> SecurityScanSection:
    section = SecurityScanSection()
    service = _build_drive_service()
    for drive in _list_shared_drives(service):
        drive_id = drive.get("id", "")
        drive_name = drive.get("name", "")
        section.assets.append(
            SecurityAsset(
                source=SecuritySource.DRIVE,
                scopeId=drive_id,
                assetType="shared_drive",
                assetIdHash=stable_hash(drive_id),
                displayName=drive_name,
                metadata={"canManageMembers": bool((drive.get("capabilities") or {}).get("canManageMembers"))},
            )
        )
        try:
            files = _list_drive_files(service, drive_id, max_files_per_drive)
            for raw_file in files:
                file_asset = _normalize_drive_file(drive_id, drive_name, raw_file)
                section.assets.append(
                    SecurityAsset(
                        source=SecuritySource.DRIVE,
                        scopeId=drive_id,
                        assetType="file",
                        assetIdHash=stable_hash(file_asset.file_id),
                        displayName=file_asset.file_name[:120],
                        metadata={
                            "mimeType": file_asset.mime_type,
                            "permissionCount": len(file_asset.permissions),
                            "modifiedTime": file_asset.modified_time or "",
                        },
                    )
                )
                section.findings.extend(evaluate_drive_file(file_asset, company_domains))
        except Exception as error:
            section.errors.append(f"drive:{drive_name}: {error}")
    return section


def _list_shared_drives(service: Any) -> List[Dict[str, Any]]:
    drives: List[Dict[str, Any]] = []
    page_token: Optional[str] = None
    while True:
        response = (
            service.drives()
            .list(
                pageSize=100,
                fields="nextPageToken,drives(id,name,capabilities)",
                useDomainAdminAccess=True,
                pageToken=page_token,
            )
            .execute()
        )
        drives.extend(response.get("drives", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            return drives


def _build_drive_service() -> Any:
    delegated_admin = os.environ.get("GOOGLE_WORKSPACE_DELEGATED_ADMIN_EMAIL")
    service_account_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    client_id = os.environ.get("GOOGLE_DRIVE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_DRIVE_CLIENT_SECRET")
    refresh_token = os.environ.get("GOOGLE_DRIVE_REFRESH_TOKEN")

    if service_account_path and delegated_admin:
        creds = ServiceAccountCredentials.from_service_account_file(
            service_account_path,
            scopes=[DRIVE_METADATA_SCOPE],
        ).with_subject(delegated_admin)
    elif client_id and client_secret and refresh_token:
        creds = OAuthCredentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=[DRIVE_METADATA_SCOPE],
        )
    else:
        creds = None
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _list_drive_files(service: Any, drive_id: str, max_files: int) -> List[Dict[str, Any]]:
    files: List[Dict[str, Any]] = []
    page_token: Optional[str] = None
    while len(files) < max_files:
        response = (
            service.files()
            .list(
                corpora="drive",
                driveId=drive_id,
                includeItemsFromAllDrives=True,
                supportsAllDrives=True,
                pageSize=min(100, max_files - len(files)),
                q="trashed = false",
                fields=(
                    "nextPageToken,"
                    "files(id,name,mimeType,copyRequiresWriterPermission,modifiedTime,"
                    "permissions(id,type,role,emailAddress,domain,allowFileDiscovery))"
                ),
                pageToken=page_token,
            )
            .execute()
        )
        files.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return files


def _normalize_drive_file(drive_id: str, drive_name: str, raw_file: Dict[str, Any]) -> DriveFileAsset:
    return DriveFileAsset(
        driveId=drive_id,
        driveName=drive_name,
        fileId=raw_file.get("id", ""),
        fileName=raw_file.get("name", ""),
        mimeType=raw_file.get("mimeType", ""),
        copyRequiresWriterPermission=raw_file.get("copyRequiresWriterPermission"),
        modifiedTime=raw_file.get("modifiedTime"),
        permissions=[
            DrivePermissionPrincipal(
                type=permission.get("type", ""),
                role=permission.get("role", ""),
                emailAddress=permission.get("emailAddress"),
                domain=permission.get("domain"),
                allowFileDiscovery=permission.get("allowFileDiscovery"),
            )
            for permission in raw_file.get("permissions", [])
        ],
    )

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class SecuritySource(str, Enum):
    GITHUB = "github"
    FIRESTORE = "firestore"
    DRIVE = "drive"
    WORKSPACE = "workspace"
    ENDPOINT = "endpoint"


class RiskLevel(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


FindingStatus = Literal["open", "resolved", "accepted"]


class SecurityFinding(BaseModel):
    id: str
    source: SecuritySource
    scope_id: str = Field(alias="scopeId")
    resource_id_hash: str = Field(alias="resourceIdHash")
    rule_id: str = Field(alias="ruleId")
    risk_level: RiskLevel = Field(alias="riskLevel")
    title: str
    reasons: List[str]
    metadata: Dict[str, Any] = Field(default_factory=dict)
    status: FindingStatus = "open"

    class Config:
        populate_by_name = True
        use_enum_values = True


class SecurityAsset(BaseModel):
    source: SecuritySource
    scope_id: str = Field(alias="scopeId")
    asset_type: str = Field(alias="assetType")
    asset_id_hash: str = Field(alias="assetIdHash")
    display_name: Optional[str] = Field(default=None, alias="displayName")
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        populate_by_name = True
        use_enum_values = True


class SecurityScanSection(BaseModel):
    assets: List[SecurityAsset] = Field(default_factory=list)
    findings: List[SecurityFinding] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)


class FindingSummary(BaseModel):
    total: int = 0
    critical: int = 0
    high: int = 0
    medium: int = 0
    low: int = 0
    info: int = 0
    by_source: Dict[str, int] = Field(default_factory=dict, alias="bySource")

    class Config:
        populate_by_name = True


class EnterpriseSecurityReport(BaseModel):
    run_id: str = Field(alias="runId")
    started_at: str = Field(alias="startedAt")
    completed_at: str = Field(alias="completedAt")
    scope: Dict[str, Any]
    summary: FindingSummary
    asset_count: int = Field(alias="assetCount")
    error_count: int = Field(alias="errorCount")
    errors: List[str]
    findings: List[SecurityFinding]
    assets: List[SecurityAsset]

    class Config:
        populate_by_name = True


class GitHubRepositoryAsset(BaseModel):
    owner: str
    name: str
    name_with_owner: str = Field(alias="nameWithOwner")
    visibility: str
    is_fork: bool = Field(alias="isFork")
    is_archived: bool = Field(alias="isArchived")
    pushed_at: Optional[str] = Field(default=None, alias="pushedAt")
    updated_at: Optional[str] = Field(default=None, alias="updatedAt")
    default_branch: Optional[str] = Field(default=None, alias="defaultBranch")
    default_branch_protected: Optional[bool] = Field(default=None, alias="defaultBranchProtected")
    secret_scanning_status: Optional[str] = Field(default=None, alias="secretScanningStatus")
    dependabot_security_updates_status: Optional[str] = Field(default=None, alias="dependabotSecurityUpdatesStatus")
    url: str

    class Config:
        populate_by_name = True


class FirestoreCollectionAsset(BaseModel):
    project_id: str = Field(alias="projectId")
    collection_id: str = Field(alias="collectionId")
    document_count: int = Field(alias="documentCount")
    sample_size: int = Field(alias="sampleSize")
    can_read: bool = Field(alias="canRead")

    class Config:
        populate_by_name = True


class DrivePermissionPrincipal(BaseModel):
    type: str
    role: str
    email_address: Optional[str] = Field(default=None, alias="emailAddress")
    domain: Optional[str] = None
    allow_file_discovery: Optional[bool] = Field(default=None, alias="allowFileDiscovery")

    class Config:
        populate_by_name = True


class DriveFileAsset(BaseModel):
    drive_id: str = Field(alias="driveId")
    drive_name: str = Field(alias="driveName")
    file_id: str = Field(alias="fileId")
    file_name: str = Field(alias="fileName")
    mime_type: str = Field(alias="mimeType")
    copy_requires_writer_permission: Optional[bool] = Field(default=None, alias="copyRequiresWriterPermission")
    modified_time: Optional[str] = Field(default=None, alias="modifiedTime")
    permissions: List[DrivePermissionPrincipal] = Field(default_factory=list)

    class Config:
        populate_by_name = True

import unittest

from security_control_plane.models import DriveFileAsset, DrivePermissionPrincipal, FirestoreCollectionAsset, GitHubRepositoryAsset
from security_control_plane.rules import evaluate_drive_file, evaluate_firestore_collection, evaluate_github_repository, summarize_findings


class SecurityControlPlaneRuleTests(unittest.TestCase):
    def test_github_public_repo_and_unprotected_branch_are_findings(self) -> None:
        findings = evaluate_github_repository(
            GitHubRepositoryAsset(
                owner="merryAI-dev",
                name="example",
                nameWithOwner="merryAI-dev/example",
                visibility="PUBLIC",
                isFork=False,
                isArchived=False,
                pushedAt=None,
                updatedAt=None,
                defaultBranch="main",
                defaultBranchProtected=False,
                url="https://github.com/merryAI-dev/example",
            )
        )

        self.assertIn("github_repo_not_private", {finding.rule_id for finding in findings})
        self.assertIn("github_default_branch_unprotected", {finding.rule_id for finding in findings})

    def test_firestore_sensitive_collection_is_a_finding(self) -> None:
        findings = evaluate_firestore_collection(
            FirestoreCollectionAsset(
                projectId="startup-acceleration-platform",
                collectionId="users",
                documentCount=10,
                sampleSize=10,
                canRead=True,
            )
        )

        self.assertEqual(findings[0].rule_id, "firestore_sensitive_collection_present")

    def test_drive_sensitive_external_writer_is_high_risk(self) -> None:
        findings = evaluate_drive_file(
            DriveFileAsset(
                driveId="drive-1",
                driveName="전사공유",
                fileId="file-1",
                fileName="임직원 급여 정산.xlsx",
                mimeType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                copyRequiresWriterPermission=False,
                permissions=[
                    DrivePermissionPrincipal(type="user", role="writer", emailAddress="external@example.com"),
                ],
            ),
            company_domains=["mysc.co.kr"],
        )

        self.assertIn("drive_sensitive_file_shared_external", {finding.rule_id for finding in findings})
        self.assertIn("drive_external_writer", {finding.rule_id for finding in findings})

    def test_summary_groups_by_source(self) -> None:
        findings = []
        findings.extend(
            evaluate_github_repository(
                GitHubRepositoryAsset(
                    owner="merryAI-dev",
                    name="example",
                    nameWithOwner="merryAI-dev/example",
                    visibility="PUBLIC",
                    isFork=False,
                    isArchived=False,
                    pushedAt=None,
                    updatedAt=None,
                    defaultBranch="main",
                    defaultBranchProtected=True,
                    url="https://github.com/merryAI-dev/example",
                )
            )
        )
        findings.extend(
            evaluate_firestore_collection(
                FirestoreCollectionAsset(
                    projectId="startup-acceleration-platform",
                    collectionId="profiles",
                    documentCount=1,
                    sampleSize=1,
                    canRead=True,
                )
            )
        )
        summary = summarize_findings(findings)

        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["bySource"]["github"], 1)
        self.assertEqual(summary["bySource"]["firestore"], 1)


if __name__ == "__main__":
    unittest.main()

import os
import unittest
from unittest.mock import patch

from security_control_plane.sink import write_report_to_firestore


class SecurityReportSinkTest(unittest.TestCase):
    def test_firestore_write_requires_an_explicit_project(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "FIREBASE_PROJECT_ID is required"):
                write_report_to_firestore(None)


if __name__ == "__main__":
    unittest.main()

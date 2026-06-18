# Google Sheets Integration Boundary

This module is for read-only Google Sheet access helpers used by the Cashflow Sheets Lab.

Allowed:

- Extract spreadsheet IDs from user-provided Google Sheet links.
- Normalize sheet metadata and grid values returned by the BFF.
- Represent Google Sheet read errors for the UI.

Forbidden:

- Write to Google Sheets.
- Calculate cashflow Actual or Projection values.
- Mutate weekly ledger, cashflow read models, or project data.

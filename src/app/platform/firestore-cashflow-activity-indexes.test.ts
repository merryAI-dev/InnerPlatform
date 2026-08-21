import { describe, expect, it } from 'vitest';
import firestoreIndexes from '../../../firebase/firestore.indexes.json';

describe('Firestore cashflow activity indexes', () => {
  it('deploys the bounded newest-first query index for every activity source', () => {
    for (const collectionGroup of [
      'cashflow_sheet_refresh_runs',
      'weekly_api_audit_events',
      'cashflow_events',
    ]) {
      expect(firestoreIndexes.indexes).toContainEqual({
        collectionGroup,
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'projectId', order: 'ASCENDING' },
          { fieldPath: 'createdAt', order: 'DESCENDING' },
        ],
      });
    }
  });
});

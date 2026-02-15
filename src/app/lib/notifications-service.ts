import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { getOrgCollectionPath } from './firebase';

export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface PlatformNotificationDoc {
  id: string;
  tenantId: string;
  recipientId: string;
  recipientRole?: string | null;
  entityType?: string;
  entityId?: string;
  projectId?: string | null;
  ledgerId?: string | null;
  eventId?: string;
  eventType?: string;
  state?: string;
  title: string;
  description: string;
  severity: NotificationSeverity;
  reason?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export function listenNotificationsForRecipient(
  db: Firestore,
  orgId: string,
  recipientId: string,
  callback: (items: PlatformNotificationDoc[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, getOrgCollectionPath(orgId, 'notifications')),
    where('recipientId', '==', recipientId),
    orderBy('createdAt', 'desc'),
    limit(50),
  );

  return onSnapshot(q, (snap) => {
    const list: PlatformNotificationDoc[] = [];
    snap.forEach((d) => list.push(d.data() as PlatformNotificationDoc));
    callback(list);
  }, (err) => {
    console.error('[Firestore] notifications listen error:', err);
  });
}


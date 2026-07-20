import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  EditLeaseClientError,
  type EditLeaseClient,
  type EditLeaseHolder,
  type EditLeaseOwnership,
  type EditLeaseStatus,
} from '../../lib/edit-lease-client';

const WARNING_MS = 5 * 60_000;

export interface EditLeaseEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface EditLeaseVisibilityTarget extends EditLeaseEventTarget {
  visibilityState: string;
}

export type EditLeaseMode = 'read-only' | 'acquiring' | 'editing' | 'held' | 'expired' | 'error';

export interface EditLeaseViewState {
  mode: EditLeaseMode;
  canEdit: boolean;
  busy: boolean;
  ownership: EditLeaseOwnership | null;
  expiresAt: string | null;
  remainingMs: number;
  warningOpen: boolean;
  expiredOpen: boolean;
  conflictOpen: boolean;
  holder: EditLeaseHolder | null;
  error: string | null;
}

export interface EditLeaseControllerOptions {
  client: EditLeaseClient;
  windowTarget?: EditLeaseEventTarget;
  documentTarget?: EditLeaseVisibilityTarget;
  now?: () => number;
  countdownIntervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface EditLeaseController {
  getState(): EditLeaseViewState;
  subscribe(listener: () => void): () => void;
  start(): void;
  dispose(): void;
  acquire(): Promise<EditLeaseOwnership | null>;
  takeover(): Promise<EditLeaseOwnership | null>;
  extend(): Promise<EditLeaseOwnership | null>;
  release(): Promise<boolean>;
  checkStatus(): Promise<EditLeaseViewState>;
  checkBeforeSave(): Promise<EditLeaseOwnership | null>;
  dismissWarning(): void;
  continueReadOnly(): void;
}

const INITIAL_STATE: EditLeaseViewState = {
  mode: 'read-only',
  canEdit: false,
  busy: false,
  ownership: null,
  expiresAt: null,
  remainingMs: 0,
  warningOpen: false,
  expiredOpen: false,
  conflictOpen: false,
  holder: null,
  error: null,
};

function browserWindowTarget(): EditLeaseEventTarget | undefined {
  if (typeof window === 'undefined') return undefined;
  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
}

function browserDocumentTarget(): EditLeaseVisibilityTarget | undefined {
  if (typeof document === 'undefined') return undefined;
  return {
    get visibilityState() {
      return document.visibilityState;
    },
    addEventListener: (type, listener) => document.addEventListener(type, listener),
    removeEventListener: (type, listener) => document.removeEventListener(type, listener),
  };
}

export function createEditLeaseController(options: EditLeaseControllerOptions): EditLeaseController {
  const now = options.now || Date.now;
  const windowTarget = options.windowTarget || browserWindowTarget();
  const documentTarget = options.documentTarget || browserDocumentTarget();
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const intervalMs = options.countdownIntervalMs ?? 1_000;
  const listeners = new Set<() => void>();
  let state = { ...INITIAL_STATE };
  let serverOffsetMs = 0;
  let warnedExpiry: string | null = null;
  let heldAcknowledgedKey: string | null = null;
  let interval: ReturnType<typeof setInterval> | undefined;
  let started = false;
  let statusPromise: Promise<EditLeaseViewState> | null = null;

  const update = (next: EditLeaseViewState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const remainingFor = (expiresAt: string): number => (
    Math.max(0, Date.parse(expiresAt) - (now() + serverOffsetMs))
  );

  const heldKey = (holder: EditLeaseHolder | null | undefined): string | null => {
    if (!holder) return null;
    if (holder.holderVersion) return holder.holderVersion;
    const versioned = holder as EditLeaseHolder & { leaseId?: string; fence?: number };
    if (versioned.leaseId && Number.isSafeInteger(versioned.fence)) {
      return `${versioned.leaseId}:${versioned.fence}`;
    }
    // The public held response intentionally hides ownership secrets. Until the
    // server exposes an opaque lease version, holder + expiry is its stable UI key.
    return `${holder.holderDisplayName}:${holder.sameActor ? 'same' : 'other'}:${holder.expiresAt}`;
  };

  const applyStatus = (status: EditLeaseStatus) => {
    serverOffsetMs = Date.parse(status.serverNow) - now();
    if (status.canEdit) {
      heldAcknowledgedKey = null;
      const changedExpiry = status.expiresAt !== state.expiresAt;
      update({
        ...state,
        mode: 'editing',
        canEdit: true,
        busy: false,
        ownership: status,
        expiresAt: status.expiresAt,
        remainingMs: remainingFor(status.expiresAt),
        warningOpen: changedExpiry ? false : state.warningOpen,
        expiredOpen: false,
        conflictOpen: false,
        holder: null,
        error: null,
      });
      return;
    }
    if (status.state === 'ACTIVE') {
      const statusKey = heldKey(status);
      if (heldAcknowledgedKey === statusKey) {
        update({
          ...state,
          mode: 'read-only',
          canEdit: false,
          busy: false,
          ownership: null,
          expiresAt: status.expiresAt,
          remainingMs: remainingFor(status.expiresAt),
          warningOpen: false,
          expiredOpen: false,
          conflictOpen: false,
          holder: status,
          error: null,
        });
        return;
      }
      update({
        ...state,
        mode: 'held',
        canEdit: false,
        busy: false,
        ownership: null,
        expiresAt: status.expiresAt,
        remainingMs: remainingFor(status.expiresAt),
        warningOpen: false,
        expiredOpen: false,
        conflictOpen: true,
        holder: status,
        error: null,
      });
      return;
    }
    heldAcknowledgedKey = null;
    const expired = status.state === 'EXPIRED';
    update({
      ...state,
      mode: expired ? 'expired' : 'read-only',
      canEdit: false,
      busy: false,
      ownership: null,
      expiresAt: status.expiresAt,
      remainingMs: 0,
      warningOpen: false,
      expiredOpen: expired,
      conflictOpen: false,
      holder: null,
      error: null,
    });
  };

  const expire = () => {
    heldAcknowledgedKey = null;
    update({
      ...state,
      mode: 'expired',
      canEdit: false,
      busy: false,
      ownership: null,
      remainingMs: 0,
      warningOpen: false,
      expiredOpen: true,
      conflictOpen: false,
    });
  };

  const failClosed = async (error: unknown) => {
    if (error instanceof EditLeaseClientError && error.status === 410) {
      expire();
      return;
    }
    if (error instanceof EditLeaseClientError && error.status === 423) {
      if (!error.holder) {
        try {
          applyStatus(await options.client.getStatus());
          return;
        } catch {
          // Fall through to a credential-free, read-only conflict state.
        }
      }
      const holder = error.holder || state.holder;
      const errorKey = heldKey(holder);
      if (heldAcknowledgedKey === errorKey) {
        update({
          ...state,
          mode: 'read-only',
          canEdit: false,
          busy: false,
          ownership: null,
          warningOpen: false,
          expiredOpen: false,
          conflictOpen: false,
          holder,
          error: null,
        });
        return;
      }
      update({
        ...state,
        mode: 'held',
        canEdit: false,
        busy: false,
        ownership: null,
        expiresAt: error.holder?.expiresAt || state.expiresAt,
        remainingMs: 0,
        warningOpen: false,
        expiredOpen: false,
        conflictOpen: true,
        holder: holder || null,
        error: null,
      });
      return;
    }
    update({
      ...state,
      mode: 'error',
      canEdit: false,
      busy: false,
      ownership: null,
      warningOpen: false,
      error: error instanceof Error ? error.message : '수정 상태를 확인하지 못했습니다.',
    });
  };

  const tick = () => {
    if (state.mode !== 'editing' || !state.expiresAt) return;
    const remainingMs = remainingFor(state.expiresAt);
    if (remainingMs === 0) {
      expire();
      return;
    }
    const shouldWarn = remainingMs <= WARNING_MS && warnedExpiry !== state.expiresAt;
    if (shouldWarn) warnedExpiry = state.expiresAt;
    if (remainingMs !== state.remainingMs || shouldWarn) {
      update({ ...state, remainingMs, warningOpen: state.warningOpen || shouldWarn });
    }
  };

  const checkStatus = (): Promise<EditLeaseViewState> => {
    if (statusPromise) return statusPromise;
    statusPromise = (async () => {
      try {
        applyStatus(await options.client.getStatus());
      } catch (error) {
        await failClosed(error);
      }
      return state;
    })().finally(() => { statusPromise = null; });
    return statusPromise;
  };
  const onVisibilityChange = () => {
    if (documentTarget?.visibilityState === 'visible') void checkStatus();
  };
  const onResume = () => { void checkStatus(); };

  const controller: EditLeaseController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      documentTarget?.addEventListener('visibilitychange', onVisibilityChange);
      windowTarget?.addEventListener('focus', onResume);
      windowTarget?.addEventListener('pageshow', onResume);
      interval = setIntervalFn(tick, intervalMs);
    },
    dispose() {
      if (!started) return;
      started = false;
      documentTarget?.removeEventListener('visibilitychange', onVisibilityChange);
      windowTarget?.removeEventListener('focus', onResume);
      windowTarget?.removeEventListener('pageshow', onResume);
      if (interval !== undefined) clearIntervalFn(interval);
      interval = undefined;
      heldAcknowledgedKey = null;
      listeners.clear();
    },
    async acquire() {
      heldAcknowledgedKey = null;
      update({ ...state, mode: 'acquiring', busy: true, expiredOpen: false, conflictOpen: false, error: null });
      try {
        const ownership = await options.client.acquire();
        applyStatus(ownership);
        tick();
        return ownership;
      } catch (error) {
        await failClosed(error);
        return null;
      }
    },
    async takeover() {
      heldAcknowledgedKey = null;
      update({ ...state, mode: 'acquiring', busy: true, expiredOpen: false, conflictOpen: false, error: null });
      try {
        const ownership = await options.client.takeover();
        applyStatus(ownership);
        tick();
        return ownership;
      } catch (error) {
        await failClosed(error);
        return null;
      }
    },
    async extend() {
      const ownership = state.ownership;
      if (!ownership) return null;
      update({ ...state, busy: true, error: null });
      try {
        const extended = await options.client.extend(ownership);
        applyStatus(extended);
        tick();
        return extended;
      } catch (error) {
        await failClosed(error);
        return null;
      }
    },
    async release() {
      const ownership = state.ownership;
      if (!ownership) return true;
      update({ ...state, busy: true, error: null });
      try {
        applyStatus(await options.client.release(ownership));
        return true;
      } catch (error) {
        await failClosed(error);
        return false;
      }
    },
    checkStatus,
    async checkBeforeSave() {
      const checked = await checkStatus();
      return checked.canEdit ? checked.ownership : null;
    },
    dismissWarning() {
      update({ ...state, warningOpen: false });
    },
    continueReadOnly() {
      heldAcknowledgedKey = heldKey(state.holder);
      update({
        ...state,
        mode: 'read-only',
        canEdit: false,
        busy: false,
        ownership: null,
        warningOpen: false,
        expiredOpen: false,
        conflictOpen: false,
      });
    },
  };
  return controller;
}

export function useEditLease(options: EditLeaseControllerOptions) {
  const controller = useMemo(
    () => createEditLeaseController(options),
    [
      options.client,
      options.windowTarget,
      options.documentTarget,
      options.now,
      options.countdownIntervalMs,
      options.setIntervalFn,
      options.clearIntervalFn,
    ],
  );
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return {
    ...state,
    acquire: controller.acquire,
    takeover: controller.takeover,
    extend: controller.extend,
    release: controller.release,
    checkStatus: controller.checkStatus,
    checkBeforeSave: controller.checkBeforeSave,
    dismissWarning: controller.dismissWarning,
    continueReadOnly: controller.continueReadOnly,
  };
}

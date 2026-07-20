import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EditLeaseClientError,
  type EditLeaseClient,
  type EditLeaseOwnership,
  type EditLeaseStatus,
} from '../../lib/edit-lease-client';
import {
  createEditLeaseController,
  type EditLeaseEventTarget,
  type EditLeaseVisibilityTarget,
} from './useEditLease';

const OWNED: EditLeaseOwnership = {
  serverNow: '2026-07-10T00:00:00.000Z',
  state: 'ACTIVE',
  canEdit: true,
  expiresAt: '2026-07-10T00:30:00.000Z',
  leaseId: 'lease-a',
  fence: 7,
};

class FakeEventTarget implements EditLeaseEventTarget {
  readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of this.listeners.get(type) || []) listener();
  }
}

class FakeDocumentTarget extends FakeEventTarget implements EditLeaseVisibilityTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

function mockClient(overrides: Partial<EditLeaseClient> = {}) {
  return {
    getStatus: vi.fn(async (): Promise<EditLeaseStatus> => OWNED),
    acquire: vi.fn(async () => OWNED),
    takeover: vi.fn(async () => OWNED),
    extend: vi.fn(async () => OWNED),
    release: vi.fn(async () => ({
      serverNow: '2026-07-10T00:01:00.000Z',
      state: 'RELEASED' as const,
      canEdit: false as const,
      expiresAt: OWNED.expiresAt,
    })),
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('createEditLeaseController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('starts read-only and acquires only after an explicit action', async () => {
    const client = mockClient();
    const controller = createEditLeaseController({ client });
    controller.start();

    expect(controller.getState().mode).toBe('read-only');
    expect(client.acquire).not.toHaveBeenCalled();

    await controller.acquire();

    expect(client.acquire).toHaveBeenCalledOnce();
    expect(controller.getState()).toMatchObject({ mode: 'editing', canEdit: true, ownership: OWNED });
    controller.dispose();
  });

  it('coalesces simultaneous visibility, focus, and pageshow status checks without extending', async () => {
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeDocumentTarget();
    const client = mockClient();
    const controller = createEditLeaseController({ client, windowTarget, documentTarget });
    controller.start();

    documentTarget.visibilityState = 'hidden';
    documentTarget.dispatch('visibilitychange');
    documentTarget.visibilityState = 'visible';
    documentTarget.dispatch('visibilitychange');
    windowTarget.dispatch('focus');
    windowTarget.dispatch('pageshow');
    await flush();

    expect(client.getStatus).toHaveBeenCalledOnce();
    expect(client.extend).not.toHaveBeenCalled();
    expect(client.acquire).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('warns once per server expiry and only manual extend changes expiresAt', async () => {
    const extended: EditLeaseOwnership = {
      ...OWNED,
      serverNow: '2026-07-10T00:26:00.000Z',
      expiresAt: '2026-07-10T00:56:00.000Z',
    };
    const client = mockClient({ extend: vi.fn(async () => extended) });
    const controller = createEditLeaseController({ client, countdownIntervalMs: 60_000 });
    controller.start();
    await controller.acquire();

    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(controller.getState()).toMatchObject({ warningOpen: true, expiresAt: OWNED.expiresAt });
    expect(client.extend).not.toHaveBeenCalled();

    controller.dismissWarning();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.getState().warningOpen).toBe(false);
    expect(controller.getState().expiresAt).toBe(OWNED.expiresAt);

    await controller.extend();
    expect(client.extend).toHaveBeenCalledOnce();
    expect(controller.getState()).toMatchObject({ warningOpen: false, expiresAt: extended.expiresAt });

    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(controller.getState()).toMatchObject({ warningOpen: true, expiresAt: extended.expiresAt });
    expect(client.extend).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('handles held and expired responses in read-only mode', async () => {
    const held = new EditLeaseClientError({
      message: 'held',
      status: 423,
      code: 'edit_lease_held',
      holder: {
        holderDisplayName: '김메리',
        sameActor: true,
        expiresAt: OWNED.expiresAt,
      },
    });
    const heldController = createEditLeaseController({
      client: mockClient({ acquire: vi.fn(async () => { throw held; }) }),
    });
    await heldController.acquire();
    expect(heldController.getState()).toMatchObject({
      mode: 'held',
      canEdit: false,
      conflictOpen: true,
      holder: held.holder,
    });

    const expired = new EditLeaseClientError({
      message: 'expired',
      status: 410,
      code: 'edit_lease_expired',
    });
    const expiredController = createEditLeaseController({
      client: mockClient({ extend: vi.fn(async () => { throw expired; }) }),
    });
    await expiredController.acquire();
    await expiredController.extend();
    expect(expiredController.getState()).toMatchObject({
      mode: 'expired',
      canEdit: false,
      expiredOpen: true,
      ownership: null,
    });
  });

  it('does not reopen a held dialog after the user chooses read-only mode', async () => {
    const windowTarget = new FakeEventTarget();
    const documentTarget = new FakeDocumentTarget();
    const held: EditLeaseStatus = {
      serverNow: '2026-07-10T00:00:00.000Z',
      state: 'ACTIVE',
      canEdit: false,
      expiresAt: OWNED.expiresAt,
      holderDisplayName: '변민욱(보람)',
      sameActor: true,
    };
    const client = mockClient({ getStatus: vi.fn(async () => held) });
    const controller = createEditLeaseController({ client, windowTarget, documentTarget });
    controller.start();

    await controller.checkStatus();
    expect(controller.getState()).toMatchObject({ mode: 'held', conflictOpen: true });

    controller.continueReadOnly();
    windowTarget.dispatch('focus');
    windowTarget.dispatch('pageshow');
    documentTarget.dispatch('visibilitychange');
    await flush();

    expect(controller.getState()).toMatchObject({ mode: 'read-only', conflictOpen: false, canEdit: false });
    controller.dispose();
  });

  it('reopens the held dialog when the acknowledged lease version changes', async () => {
    const heldA: EditLeaseStatus = {
      serverNow: '2026-07-10T00:00:00.000Z',
      state: 'ACTIVE',
      canEdit: false,
      expiresAt: '2026-07-10T00:30:00.000Z',
      holderDisplayName: '변민욱(보람)',
      sameActor: true,
      holderVersion: 'opaque-v1',
    };
    const extendedSameLease: EditLeaseStatus = {
      ...heldA,
      serverNow: '2026-07-10T00:10:00.000Z',
      expiresAt: '2026-07-10T01:01:00.000Z',
    };
    const heldB: EditLeaseStatus = {
      ...extendedSameLease,
      serverNow: '2026-07-10T01:02:00.000Z',
      holderVersion: 'opaque-v2',
    };
    const client = mockClient({
      getStatus: vi.fn()
        .mockResolvedValueOnce(heldA)
        .mockResolvedValueOnce(extendedSameLease)
        .mockResolvedValueOnce(heldB),
    });
    const controller = createEditLeaseController({ client });

    await controller.checkStatus();
    controller.continueReadOnly();
    await controller.checkStatus();
    expect(controller.getState()).toMatchObject({ mode: 'read-only', conflictOpen: false });

    await controller.checkStatus();
    expect(controller.getState()).toMatchObject({ mode: 'held', conflictOpen: true, expiresAt: heldB.expiresAt });
  });

  it('exposes a pre-save status check and never releases on unload or dispose', async () => {
    const windowTarget = new FakeEventTarget();
    const client = mockClient();
    const controller = createEditLeaseController({ client, windowTarget });
    controller.start();
    await controller.acquire();

    const ownership = await controller.checkBeforeSave();
    windowTarget.dispatch('beforeunload');
    windowTarget.dispatch('unload');
    controller.dispose();

    expect(ownership).toEqual(OWNED);
    expect(client.getStatus).toHaveBeenCalledOnce();
    expect(client.release).not.toHaveBeenCalled();
    expect(windowTarget.listeners.has('beforeunload')).toBe(false);
    expect(windowTarget.listeners.has('unload')).toBe(false);
  });

  it('reports whether a manual release reached the server', async () => {
    const releasedController = createEditLeaseController({ client: mockClient() });
    await releasedController.acquire();
    await expect(releasedController.release()).resolves.toBe(true);

    const failedController = createEditLeaseController({
      client: mockClient({ release: vi.fn(async () => { throw new Error('network unavailable'); }) }),
    });
    await failedController.acquire();
    await expect(failedController.release()).resolves.toBe(false);
    expect(failedController.getState()).toMatchObject({ mode: 'error', canEdit: false });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createEditSessionRuntime,
  openEditSession,
  type BroadcastChannelLike,
  type EditSessionStorage,
} from './edit-session';

class MemoryStorage implements EditSessionStorage {
  constructor(private readonly values = new Map<string, string>()) {}

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  clone(): MemoryStorage {
    return new MemoryStorage(new Map(this.values));
  }
}

class ChannelHub {
  readonly channels = new Set<FakeChannel>();

  constructor(private readonly deliveryDelayMs = 0) {}

  create = (): BroadcastChannelLike => {
    const channel = new FakeChannel(this);
    this.channels.add(channel);
    return channel;
  };

  send(sender: FakeChannel, data: unknown): void {
    for (const channel of this.channels) {
      if (channel === sender) continue;
      if (this.deliveryDelayMs) {
        setTimeout(() => channel.deliver(data), this.deliveryDelayMs);
      } else {
        channel.deliver(data);
      }
    }
  }
}

class FakeChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<(event: { data: unknown }) => void>();

  constructor(private readonly hub: ChannelHub) {}

  postMessage(data: unknown): void {
    this.hub.send(this, data);
  }

  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.hub.channels.delete(this);
    this.listeners.clear();
  }

  deliver(data: unknown): void {
    for (const listener of this.listeners) listener({ data });
  }
}

const UUIDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

describe('openEditSession', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reuses the sessionStorage UUID after a genuine reload', async () => {
    const hub = new ChannelHub();
    const storage = new MemoryStorage();
    const createUuid = vi.fn().mockReturnValueOnce(UUIDS[0]).mockReturnValueOnce(UUIDS[1]);

    const firstPending = openEditSession({ storage, createChannel: hub.create, createUuid });
    await vi.advanceTimersByTimeAsync(100);
    const first = await firstPending;
    first.dispose();

    const reloadedPending = openEditSession({ storage, createChannel: hub.create, createUuid });
    await vi.advanceTimersByTimeAsync(100);
    const reloaded = await reloadedPending;

    expect(reloaded.sessionId).toBe(first.sessionId);
    expect(createUuid).toHaveBeenCalledOnce();
    reloaded.dispose();
  });

  it('rotates a cloned sessionStorage UUID when another live tab owns it', async () => {
    const hub = new ChannelHub(20);
    const originalStorage = new MemoryStorage();
    const createUuid = vi.fn()
      .mockReturnValueOnce(UUIDS[0])
      .mockReturnValueOnce(UUIDS[1])
      .mockReturnValueOnce(UUIDS[2]);

    const firstPending = openEditSession({
      storage: originalStorage,
      createChannel: hub.create,
      createUuid,
      runtime: createEditSessionRuntime(),
    });
    await vi.advanceTimersByTimeAsync(100);
    const first = await firstPending;

    const clonedStorage = originalStorage.clone();
    const duplicatePending = openEditSession({
      storage: clonedStorage,
      createChannel: hub.create,
      createUuid,
      runtime: createEditSessionRuntime(),
    });
    await vi.advanceTimersByTimeAsync(100);
    const duplicate = await duplicatePending;

    expect(first.sessionId).toBe(UUIDS[0]);
    expect(duplicate.sessionId).toBe(UUIDS[1]);
    expect(duplicate.sessionId).not.toBe(first.sessionId);

    first.dispose();
    duplicate.dispose();
  });

  it('shares one live identity across repeated consumers in the same tab', async () => {
    const hub = new ChannelHub();
    const storage = new MemoryStorage();
    const createUuid = vi.fn().mockReturnValueOnce(UUIDS[0]).mockReturnValueOnce(UUIDS[1]);

    const firstPending = openEditSession({ storage, createChannel: hub.create, createUuid });
    await vi.advanceTimersByTimeAsync(100);
    const first = await firstPending;

    const secondPending = openEditSession({ storage, createChannel: hub.create, createUuid });
    await vi.advanceTimersByTimeAsync(100);
    const second = await secondPending;

    expect(second.sessionId).toBe(first.sessionId);
    expect(createUuid).toHaveBeenCalledOnce();
    expect(hub.channels.size).toBe(1);

    first.dispose();
    expect(hub.channels.size).toBe(1);
    second.dispose();
    expect(hub.channels.size).toBe(0);
  });
});

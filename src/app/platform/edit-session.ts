export interface EditSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BroadcastChannelLike {
  postMessage(data: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface EditSession {
  sessionId: string;
  dispose(): void;
}

export interface EditSessionRuntime {}

const STORAGE_KEY = 'myscube.edit-session.v1';
const CHANNEL_NAME = 'myscube-edit-session-v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProbeMessage {
  type: 'probe' | 'owned';
  sessionId: string;
  probeId: string;
}

interface SharedEditSession {
  promise: Promise<EditSession>;
  references: number;
}

const DEFAULT_RUNTIME: EditSessionRuntime = {};
const sharedSessions = new WeakMap<EditSessionRuntime, SharedEditSession>();

export function createEditSessionRuntime(): EditSessionRuntime {
  return {};
}

function isProbeMessage(value: unknown): value is ProbeMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ProbeMessage>;
  return (message.type === 'probe' || message.type === 'owned')
    && typeof message.sessionId === 'string'
    && typeof message.probeId === 'string';
}

function defaultUuid(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure UUID generation is unavailable');
  }
  return crypto.randomUUID();
}

function requireUuid(createUuid: () => string): string {
  const value = createUuid();
  if (!UUID_PATTERN.test(value)) throw new Error('Edit session ID must be a UUID');
  return value;
}

function nativeChannel(): BroadcastChannelLike {
  if (typeof BroadcastChannel === 'undefined') {
    throw new Error('BroadcastChannel is required for safe edit sessions');
  }
  return new BroadcastChannel(CHANNEL_NAME) as unknown as BroadcastChannelLike;
}

function nativeStorage(): EditSessionStorage {
  if (typeof sessionStorage === 'undefined') {
    throw new Error('sessionStorage is required for edit sessions');
  }
  return sessionStorage;
}

interface OpenEditSessionOptions {
  storage?: EditSessionStorage;
  createChannel?: () => BroadcastChannelLike;
  createUuid?: () => string;
  createProbeId?: () => string;
  probeDelayMs?: number;
  setTimeoutFn?: typeof setTimeout;
  runtime?: EditSessionRuntime;
}

async function establishEditSession(options: OpenEditSessionOptions): Promise<EditSession> {
  const storage = options.storage || nativeStorage();
  const createUuid = options.createUuid || defaultUuid;
  const createProbeId = options.createProbeId || defaultUuid;
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const probeDelayMs = options.probeDelayMs ?? 75;
  const stored = storage.getItem(STORAGE_KEY);
  let sessionId = stored && UUID_PATTERN.test(stored) ? stored : requireUuid(createUuid);
  const probeId = createProbeId();
  const channel = (options.createChannel || nativeChannel)();
  let collision = false;

  const onMessage = (event: { data: unknown }) => {
    if (!isProbeMessage(event.data)) return;
    if (event.data.type === 'probe' && event.data.sessionId === sessionId) {
      channel.postMessage({ type: 'owned', sessionId, probeId: event.data.probeId } satisfies ProbeMessage);
      return;
    }
    if (
      event.data.type === 'owned'
      && event.data.sessionId === sessionId
      && event.data.probeId === probeId
    ) {
      collision = true;
    }
  };

  try {
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'probe', sessionId, probeId } satisfies ProbeMessage);
    await new Promise<void>((resolve) => setTimeoutFn(resolve, probeDelayMs));

    if (collision) {
      const previous = sessionId;
      sessionId = requireUuid(createUuid);
      if (sessionId === previous) throw new Error('Edit session UUID collision could not be resolved');
    }
    storage.setItem(STORAGE_KEY, sessionId);

    return {
      sessionId,
      dispose() {
        channel.removeEventListener('message', onMessage);
        channel.close();
      },
    };
  } catch (error) {
    channel.removeEventListener('message', onMessage);
    channel.close();
    throw error;
  }
}

export async function openEditSession(options: OpenEditSessionOptions = {}): Promise<EditSession> {
  const runtime = options.runtime || DEFAULT_RUNTIME;
  let shared = sharedSessions.get(runtime);
  if (!shared) {
    shared = { promise: establishEditSession(options), references: 0 };
    sharedSessions.set(runtime, shared);
  }
  shared.references += 1;

  let underlying: EditSession;
  try {
    underlying = await shared.promise;
  } catch (error) {
    shared.references -= 1;
    if (sharedSessions.get(runtime) === shared) sharedSessions.delete(runtime);
    throw error;
  }

  let disposed = false;
  return {
    sessionId: underlying.sessionId,
    dispose() {
      if (disposed) return;
      disposed = true;
      shared.references -= 1;
      if (shared.references === 0 && sharedSessions.get(runtime) === shared) {
        sharedSessions.delete(runtime);
        underlying.dispose();
      }
    },
  };
}

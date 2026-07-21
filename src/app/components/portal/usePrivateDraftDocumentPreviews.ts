import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectRequestDocumentKind } from '../../platform/project-contract-upload';

export type PrivateDraftDocumentPreviewState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
};

type PrivateDraftAttachmentRef = {
  documentKind: ProjectRequestDocumentKind;
  path: string;
};

type LoadPrivateDraftAttachment = (input: {
  documentKind: ProjectRequestDocumentKind;
  signal: AbortSignal;
}) => Promise<{ blob: Blob }>;

function attachmentCacheKey(attachment: PrivateDraftAttachmentRef) {
  return `${attachment.documentKind}\u0000${attachment.path}`;
}

export function usePrivateDraftDocumentPreviews({
  attachments,
  enabled = true,
  loadAttachment,
}: {
  attachments: PrivateDraftAttachmentRef[];
  enabled?: boolean;
  loadAttachment: LoadPrivateDraftAttachment;
}) {
  const [documentPreviewUrls, setDocumentPreviewUrls] = useState<Partial<Record<ProjectRequestDocumentKind, string>>>({});
  const [documentPreviewStates, setDocumentPreviewStates] = useState<Partial<Record<ProjectRequestDocumentKind, PrivateDraftDocumentPreviewState>>>({});
  const attachmentKey = useMemo(() => JSON.stringify(attachments.map(({ documentKind, path }) => ({ documentKind, path }))), [attachments]);
  const currentAttachmentsRef = useRef(new Map<ProjectRequestDocumentKind, PrivateDraftAttachmentRef>());
  const cacheRef = useRef(new Map<string, string>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const stateKeysRef = useRef(new Map<ProjectRequestDocumentKind, string>());
  const statesRef = useRef(new Map<ProjectRequestDocumentKind, PrivateDraftDocumentPreviewState>());
  const loadAttachmentRef = useRef(loadAttachment);
  const enabledRef = useRef(enabled);
  const mountedRef = useRef(true);

  loadAttachmentRef.current = loadAttachment;
  enabledRef.current = enabled;

  const releaseAll = useCallback((publish: boolean) => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    cacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    cacheRef.current.clear();
    stateKeysRef.current.clear();
    statesRef.current.clear();
    if (publish) {
      setDocumentPreviewUrls({});
      setDocumentPreviewStates({});
    }
  }, []);

  const loadDocumentPreview = useCallback(async (documentKind: ProjectRequestDocumentKind) => {
    const attachment = currentAttachmentsRef.current.get(documentKind);
    if (!attachment || !enabledRef.current || !mountedRef.current) return;

    const key = attachmentCacheKey(attachment);
    const cachedUrl = cacheRef.current.get(key);
    if (cachedUrl) {
      statesRef.current.set(documentKind, { status: 'ready' });
      setDocumentPreviewUrls((current) => ({ ...current, [documentKind]: cachedUrl }));
      setDocumentPreviewStates((current) => ({ ...current, [documentKind]: { status: 'ready' } }));
      return;
    }
    if (controllersRef.current.has(key)) return;

    const controller = new AbortController();
    controllersRef.current.set(key, controller);
    stateKeysRef.current.set(documentKind, key);
    statesRef.current.set(documentKind, { status: 'loading' });
    setDocumentPreviewStates((current) => ({ ...current, [documentKind]: { status: 'loading' } }));

    try {
      const { blob } = await loadAttachmentRef.current({ documentKind, signal: controller.signal });
      if (controller.signal.aborted || !enabledRef.current || !mountedRef.current) return;
      const currentAttachment = currentAttachmentsRef.current.get(documentKind);
      if (!currentAttachment || attachmentCacheKey(currentAttachment) !== key) return;

      const url = URL.createObjectURL(blob);
      cacheRef.current.set(key, url);
      statesRef.current.set(documentKind, { status: 'ready' });
      setDocumentPreviewUrls((current) => ({ ...current, [documentKind]: url }));
      setDocumentPreviewStates((current) => ({ ...current, [documentKind]: { status: 'ready' } }));
    } catch (error) {
      if (controller.signal.aborted || !mountedRef.current) return;
      const previewState = {
        status: 'error' as const,
        error: error instanceof Error ? error.message : '첨부 파일을 불러오지 못했습니다.',
      };
      statesRef.current.set(documentKind, previewState);
      setDocumentPreviewStates((current) => ({
        ...current,
        [documentKind]: previewState,
      }));
    } finally {
      if (controllersRef.current.get(key) === controller) controllersRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseAll(false);
    };
  }, [releaseAll]);

  useEffect(() => {
    const nextAttachments = new Map<ProjectRequestDocumentKind, PrivateDraftAttachmentRef>();
    for (const attachment of JSON.parse(attachmentKey) as PrivateDraftAttachmentRef[]) {
      nextAttachments.set(attachment.documentKind, attachment);
    }
    currentAttachmentsRef.current = nextAttachments;

    if (!enabled) {
      releaseAll(true);
      return;
    }

    const activeKeys = new Set(Array.from(nextAttachments.values(), attachmentCacheKey));
    for (const [key, controller] of controllersRef.current) {
      if (!activeKeys.has(key)) {
        controller.abort();
        controllersRef.current.delete(key);
      }
    }
    for (const [key, url] of cacheRef.current) {
      if (!activeKeys.has(key)) {
        URL.revokeObjectURL(url);
        cacheRef.current.delete(key);
      }
    }

    const nextUrls: Partial<Record<ProjectRequestDocumentKind, string>> = {};
    const nextStates: Partial<Record<ProjectRequestDocumentKind, PrivateDraftDocumentPreviewState>> = {};
    const nextStateMap = new Map<ProjectRequestDocumentKind, PrivateDraftDocumentPreviewState>();
    for (const [documentKind, attachment] of nextAttachments) {
      const key = attachmentCacheKey(attachment);
      const cachedUrl = cacheRef.current.get(key);
      if (cachedUrl) {
        nextUrls[documentKind] = cachedUrl;
        nextStates[documentKind] = { status: 'ready' };
      } else if (controllersRef.current.has(key)) {
        nextStates[documentKind] = { status: 'loading' };
      } else if (stateKeysRef.current.get(documentKind) === key) {
        nextStates[documentKind] = statesRef.current.get(documentKind) || { status: 'idle' };
      } else {
        stateKeysRef.current.set(documentKind, key);
        nextStates[documentKind] = { status: 'idle' };
      }
      nextStateMap.set(documentKind, nextStates[documentKind]!);
    }
    statesRef.current = nextStateMap;
    setDocumentPreviewUrls(nextUrls);
    setDocumentPreviewStates(nextStates);
    if (nextAttachments.has('contract')) void loadDocumentPreview('contract');
  }, [attachmentKey, enabled, loadDocumentPreview, releaseAll]);

  const visibleDocumentPreviewUrls = useMemo(() => {
    if (!enabled) return {};
    const visible: Partial<Record<ProjectRequestDocumentKind, string>> = {};
    for (const attachment of JSON.parse(attachmentKey) as PrivateDraftAttachmentRef[]) {
      const key = attachmentCacheKey(attachment);
      const cachedUrl = cacheRef.current.get(key);
      if (cachedUrl && cachedUrl === documentPreviewUrls[attachment.documentKind]) {
        visible[attachment.documentKind] = cachedUrl;
      }
    }
    return visible;
  }, [attachmentKey, documentPreviewUrls, enabled]);
  const visibleDocumentPreviewStates = useMemo(() => {
    if (!enabled) return {};
    const visible: Partial<Record<ProjectRequestDocumentKind, PrivateDraftDocumentPreviewState>> = {};
    for (const attachment of JSON.parse(attachmentKey) as PrivateDraftAttachmentRef[]) {
      const state = documentPreviewStates[attachment.documentKind];
      if (stateKeysRef.current.get(attachment.documentKind) === attachmentCacheKey(attachment) && state) {
        visible[attachment.documentKind] = state;
      }
    }
    return visible;
  }, [attachmentKey, documentPreviewStates, enabled]);

  return {
    documentPreviewUrls: visibleDocumentPreviewUrls,
    documentPreviewStates: visibleDocumentPreviewStates,
    loadDocumentPreview,
  };
}

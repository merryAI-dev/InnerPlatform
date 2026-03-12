import { describe, expect, it } from 'vitest';
import {
  buildPreviewAuthBlockedMessage,
  isLocalAuthHost,
  isStableVercelAliasHost,
  isStableVercelPreviewHost,
  readPreviewAuthGuardConfig,
  shouldBlockFirebasePopupAuth,
} from './preview-auth';

describe('preview-auth', () => {
  it('reads allowed hosts from env and fallback url', () => {
    expect(readPreviewAuthGuardConfig({
      VITE_FIREBASE_AUTH_ALLOWED_HOSTS: 'app.example.com, https://inner-platform.vercel.app/path',
      VITE_FIREBASE_AUTH_FALLBACK_URL: 'https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app',
    })).toEqual({
      allowedHosts: [
        'app.example.com',
        'inner-platform.vercel.app',
        'inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app',
      ],
      fallbackUrl: 'https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app',
    });
  });

  it('detects local and stable vercel preview hosts', () => {
    expect(isLocalAuthHost('http://localhost:5173')).toBe(true);
    expect(isLocalAuthHost('127.0.0.1')).toBe(true);
    expect(isStableVercelPreviewHost('inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app')).toBe(true);
    expect(isStableVercelPreviewHost('inner-platform-bbig48qgr-merryai-devs-projects.vercel.app')).toBe(false);
    expect(isStableVercelAliasHost('inner-platform.vercel.app')).toBe(true);
    expect(isStableVercelAliasHost('inner-platform-merryai-devs-projects.vercel.app')).toBe(true);
    expect(isStableVercelAliasHost('inner-platform-bbig48qgr-merryai-devs-projects.vercel.app')).toBe(false);
  });

  it('blocks random vercel preview hosts and allows configured or stable hosts', () => {
    const env = {
      VITE_FIREBASE_AUTH_ALLOWED_HOSTS: 'inner-platform.vercel.app',
      VITE_FIREBASE_AUTH_FALLBACK_URL: 'https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app',
    };

    expect(shouldBlockFirebasePopupAuth('inner-platform-bbig48qgr-merryai-devs-projects.vercel.app', env)).toBe(true);
    expect(shouldBlockFirebasePopupAuth('inner-platform-e6ksf2q01-merryai-devs-projects.vercel.app', env)).toBe(true);
    expect(shouldBlockFirebasePopupAuth('inner-platform.vercel.app', env)).toBe(false);
    expect(shouldBlockFirebasePopupAuth('inner-platform-merryai-devs-projects.vercel.app', env)).toBe(false);
    expect(shouldBlockFirebasePopupAuth('inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app', env)).toBe(false);
    expect(shouldBlockFirebasePopupAuth('localhost', env)).toBe(false);
  });

  it('builds an actionable blocked message', () => {
    expect(buildPreviewAuthBlockedMessage(
      'inner-platform-bbig48qgr-merryai-devs-projects.vercel.app',
      { VITE_FIREBASE_AUTH_FALLBACK_URL: 'https://inner-platform-git-ft-izzie-merryai-devs-projects.vercel.app' },
    )).toContain('고정 preview 주소');
  });
});

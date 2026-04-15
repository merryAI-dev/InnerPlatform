import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { useFirestoreAccessPolicy } from './firestore-realtime-mode';

function PassthroughProvider({ children }: { children: ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

vi.mock('./board-store', () => ({
  BoardProvider: PassthroughProvider,
}));

vi.mock('./career-profile-store', () => ({
  CareerProfileProvider: PassthroughProvider,
}));

vi.mock('./cashflow-weeks-store', () => ({
  CashflowWeekProvider: PassthroughProvider,
}));

vi.mock('./hr-announcements-store', () => ({
  HrAnnouncementProvider: PassthroughProvider,
}));

vi.mock('./payroll-store', () => ({
  PayrollProvider: PassthroughProvider,
}));

vi.mock('./training-store', () => ({
  TrainingProvider: PassthroughProvider,
}));

import { AdminRouteProviders } from './admin-route-providers';
import { PortalRouteProviders } from './portal-route-providers';

function PolicyProbe({ role }: { role: string }) {
  const policy = useFirestoreAccessPolicy(role);
  const serialized = [
    policy.routeMode,
    String(policy.allowRealtimeListeners),
    String(policy.allowPrivilegedReadAll),
    String(policy.useSafeFetchMode),
  ].join('|');

  return React.createElement('pre', { id: 'policy' }, serialized);
}

function readPolicy(wrapper: typeof AdminRouteProviders | typeof PortalRouteProviders, role: string) {
  const markup = renderToStaticMarkup(
    React.createElement(
      wrapper,
      null,
      React.createElement(PolicyProbe, { role }),
    ),
  );

  const match = markup.match(/<pre id="policy">([^<]+)<\/pre>/);
  expect(match?.[1]).toBeTruthy();

  const [routeMode, allowRealtimeListeners, allowPrivilegedReadAll, useSafeFetchMode] = String(match?.[1]).split('|');
  return {
    routeMode,
    allowRealtimeListeners,
    allowPrivilegedReadAll,
    useSafeFetchMode,
  };
}

describe('route provider behavior', () => {
  it('keeps admin routes in admin-live mode for privileged operators', () => {
    expect(readPolicy(AdminRouteProviders, 'admin')).toEqual({
      routeMode: 'admin-live',
      allowRealtimeListeners: 'true',
      allowPrivilegedReadAll: 'true',
      useSafeFetchMode: 'false',
    });
    expect(readPolicy(AdminRouteProviders, 'finance')).toEqual({
      routeMode: 'admin-live',
      allowRealtimeListeners: 'true',
      allowPrivilegedReadAll: 'true',
      useSafeFetchMode: 'false',
    });
  });

  it('forces portal routes into safe mode even for privileged operators', () => {
    expect(readPolicy(PortalRouteProviders, 'admin')).toEqual({
      routeMode: 'portal-safe',
      allowRealtimeListeners: 'false',
      allowPrivilegedReadAll: 'false',
      useSafeFetchMode: 'true',
    });
    expect(readPolicy(PortalRouteProviders, 'finance')).toEqual({
      routeMode: 'portal-safe',
      allowRealtimeListeners: 'false',
      allowPrivilegedReadAll: 'false',
      useSafeFetchMode: 'true',
    });
  });
});

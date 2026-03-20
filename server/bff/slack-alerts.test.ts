import { describe, expect, it, vi } from 'vitest';
import { createSlackAlertService } from './slack-alerts.mjs';

describe('createSlackAlertService', () => {
  it('stays disabled without a webhook URL', () => {
    const service = createSlackAlertService({ webhookUrl: '' });
    expect(service.enabled).toBe(false);
    expect(service.shouldAlertClientError({ level: 'fatal' })).toBe(false);
  });

  it('sends a Slack webhook payload for eligible client errors', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'ok',
    }));
    const service = createSlackAlertService({
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXX',
      minLevel: 'error',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(service.enabled).toBe(true);
    expect(service.shouldAlertClientError({ level: 'warning' })).toBe(false);
    expect(service.shouldAlertClientError({ level: 'error' })).toBe(true);

    await service.notifyClientError({
      level: 'error',
      source: 'portal_store',
      message: 'Projects listen failed',
      tenantId: 'mysc',
      actorId: 'u-1',
      route: '/portal/project-settings',
      requestId: 'req_1',
      extra: { action: 'projects_listen' },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T000/B000/XXX');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.text).toContain('[InnerPlatform][ERROR]');
    expect(body.blocks[0].text.text).toContain('portal_store');
    expect(body.blocks[0].text.text).toContain('Projects listen failed');
  });

  it('falls back to chat.postMessage when bot token and channel are configured', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, ts: '123.456' }),
    }));
    const service = createSlackAlertService({
      webhookUrl: '',
      botToken: 'xoxb-test-token',
      channelId: 'C1234567890',
      minLevel: 'warning',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(service.enabled).toBe(true);
    expect(service.mode).toBe('bot');
    expect(service.shouldAlertClientError({ level: 'info' })).toBe(false);
    expect(service.shouldAlertClientError({ level: 'warning' })).toBe(true);

    await service.notifyClientError({
      level: 'warning',
      source: 'platform_api',
      message: 'API latency spike',
      tenantId: 'mysc',
      actorId: 'u-2',
      route: '/portal/dashboard',
      requestId: 'req_2',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://slack.com/api/chat.postMessage');
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer xoxb-test-token');
    const body = JSON.parse(String(init.body));
    expect(body.channel).toBe('C1234567890');
    expect(body.text).toContain('[InnerPlatform][WARNING]');
  });
});

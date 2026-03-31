function readText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLevel(value) {
  const normalized = readText(value).toLowerCase();
  if (normalized === 'fatal' || normalized === 'warning' || normalized === 'info') {
    return normalized;
  }
  return 'error';
}

function levelRank(level) {
  switch (normalizeLevel(level)) {
    case 'info':
      return 10;
    case 'warning':
      return 20;
    case 'error':
      return 30;
    case 'fatal':
      return 40;
    default:
      return 30;
  }
}

function truncate(value, maxLength) {
  const text = readText(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function stringifyExtra(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    return truncate(JSON.stringify(value), 800);
  } catch {
    return '';
  }
}

function buildSlackPayload(event) {
  const level = normalizeLevel(event.level).toUpperCase();
  const title = `[InnerPlatform][${level}] ${truncate(event.source || 'client_error', 80)}`;
  const summary = truncate(event.message || 'Unknown client error', 280);
  const route = truncate(event.route || '-', 180);
  const actor = truncate(event.actorId || '-', 80);
  const tenant = truncate(event.tenantId || '-', 80);
  const requestId = truncate(event.requestId || event.clientRequestId || '-', 120);
  const href = truncate(event.href || '', 280);
  const extra = stringifyExtra(event.extra);

  const lines = [
    `*${title}*`,
    summary,
    `tenant: \`${tenant}\`  actor: \`${actor}\`  source: \`${truncate(event.source || '-', 80)}\``,
    `route: \`${route}\``,
    `request: \`${requestId}\``,
  ];
  if (href) lines.push(`link: ${href}`);
  if (extra) lines.push(`extra: \`${extra}\``);

  return {
    text: `${title} ${summary}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      },
    ],
  };
}

export function createSlackAlertService({
  webhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL,
  botToken = process.env.SLACK_ALERT_BOT_TOKEN,
  channelId = process.env.SLACK_ALERT_CHANNEL_ID,
  minLevel = process.env.CLIENT_ERROR_SLACK_MIN_LEVEL || 'fatal',
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedWebhookUrl = readText(webhookUrl);
  const normalizedBotToken = readText(botToken);
  const normalizedChannelId = readText(channelId);
  const normalizedMinLevel = normalizeLevel(minLevel);
  const mode = normalizedWebhookUrl
    ? 'webhook'
    : (normalizedBotToken && normalizedChannelId ? 'bot' : 'disabled');

  async function sendPayload(payload) {
    if (mode === 'disabled') {
      throw new Error('Slack delivery target is not configured');
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Fetch is not available for Slack delivery');
    }

    if (mode === 'webhook') {
      const response = await fetchImpl(normalizedWebhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`Slack webhook failed (${response.status}) ${truncate(body, 200)}`.trim());
      }
      return;
    }

    const response = await fetchImpl('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'authorization': `Bearer ${normalizedBotToken}`,
      },
      body: JSON.stringify({
        channel: normalizedChannelId,
        text: payload.text,
        blocks: payload.blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      throw new Error(`Slack chat.postMessage failed (${response.status}) ${truncate(body?.error || '', 200)}`.trim());
    }
  }

  return {
    enabled: mode !== 'disabled' && typeof fetchImpl === 'function',
    minLevel: normalizedMinLevel,
    mode,

    shouldAlertClientError(event) {
      if (mode === 'disabled') return false;
      return levelRank(event?.level) >= levelRank(normalizedMinLevel);
    },

    async notifyMessage(payload) {
      const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
      const text = truncate(normalizedPayload.text || '', 3000) || 'InnerPlatform notification';
      const blocks = Array.isArray(normalizedPayload.blocks) ? normalizedPayload.blocks : undefined;
      await sendPayload({ text, ...(blocks ? { blocks } : {}) });
    },

    async notifyClientError(event) {
      await sendPayload(buildSlackPayload(event));
    },
  };
}

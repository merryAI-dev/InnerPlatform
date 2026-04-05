import { describe, expect, it } from 'vitest';
import { resolveProjectRegistrationSlackConfig } from './app.mjs';

describe('resolveProjectRegistrationSlackConfig', () => {
  it('falls back to shared Slack bot settings when project-specific channel is unset', () => {
    const config = resolveProjectRegistrationSlackConfig({}, {
      SLACK_ALERT_BOT_TOKEN: 'xoxb-shared',
      SLACK_ALERT_CHANNEL_ID: 'C_SHARED_ALERTS',
    });

    expect(config).toMatchObject({
      botToken: 'xoxb-shared',
      channelId: 'C_SHARED_ALERTS',
    });
  });

  it('prefers project-specific Slack settings when they are configured', () => {
    const config = resolveProjectRegistrationSlackConfig({}, {
      PROJECT_REGISTRATION_SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T000/B000/PROJECT',
      PROJECT_REGISTRATION_SLACK_BOT_TOKEN: 'xoxb-project',
      PROJECT_REGISTRATION_SLACK_CHANNEL_ID: 'C_PROJECT_ONLY',
      SLACK_ALERT_BOT_TOKEN: 'xoxb-shared',
      SLACK_ALERT_CHANNEL_ID: 'C_SHARED_ALERTS',
    });

    expect(config).toMatchObject({
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/PROJECT',
      botToken: 'xoxb-project',
      channelId: 'C_PROJECT_ONLY',
    });
  });
});

# Slack Webhook Setup

This directory contains the Slack app manifest used for the daily Cloudflare security report webhook.

## App

- Name: MYSC Guard Security Reports
- Scope: `incoming-webhook`
- Destination: choose the approved security monitoring channel during Slack authorization.

## Create Webhook

1. Log in to Slack CLI:

   ```sh
   slack auth login
   ```

2. Create a Slack app from `cloudflare-security-report-slack-app-manifest.json`.

   Slack supports creating apps from a manifest in the UI or with the App Manifest API. The actual incoming webhook URL is issued only after workspace/channel authorization.

3. In Slack app settings, open `Incoming Webhooks`, click `Add New Webhook to Workspace`, choose the approved channel, and authorize.

4. Store the generated webhook URL in GitHub Actions secrets:

   ```sh
   gh secret set SLACK_WEBHOOK_URL --repo merryAI-dev/MYSCube --body '<hooks.slack.com URL>'
   ```

5. Smoke test the scheduled workflow:

   ```sh
   gh workflow run "Cloudflare Security Daily Report" --repo merryAI-dev/MYSCube
   ```

## Security

- Never commit the webhook URL.
- Treat the webhook URL as a secret. Rotate it if exposed.
- Incoming webhooks post only to the channel selected at authorization time.

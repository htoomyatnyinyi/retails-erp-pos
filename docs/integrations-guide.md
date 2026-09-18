# Integrations guide

Webhooks notify your server automatically; API keys are for trusted server-to-server access.

## Webhooks

1. Go to **Manage → Integrations → Webhooks** and tap **Add webhook**.
2. Use an HTTPS endpoint you control, choose events, and add a private signing secret.
3. Return a 2xx response after accepting each POST.
4. Verify the `X-POS-Signature` HMAC-SHA256 against the raw JSON body before processing it.

Payloads contain `event`, `tenantId`, `occurredAt`, and `data`.

## API keys

Create one key for each trusted server. Copy its secret once and store it only in a server-side environment variable or secret manager. Revoke immediately if exposed.

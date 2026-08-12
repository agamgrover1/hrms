# n8n · HRMS → Slack celebrations

Daily post to `#general` with today's birthdays and work anniversaries
pulled from the HRMS database.

## Setup

### 1. Set the webhook token on Vercel

Generate any random string (≥ 32 chars):

```
openssl rand -hex 32
```

Add it to the HRMS Vercel project under **Settings → Environment Variables**:

- **Name:** `WEBHOOK_TOKEN`
- **Value:** the generated secret
- **Environments:** Production (and Preview if you want to test there)

Redeploy so the env var takes effect.

### 2. Verify the endpoint

```
curl "https://hr.digitalleapmarketing.com/api/webhooks/celebrations?token=YOUR_TOKEN"
```

Expected shape (empty arrays on quiet days):

```json
{
  "date": "2026-08-12",
  "birthdays": [
    { "name": "Vansh Arora", "first_name": "Vansh", "employee_id": "DL0067", "designation": "SEO Team Lead", "department": "Marketing", "turning_age": 24 }
  ],
  "anniversaries": [
    { "name": "Mandeep Singh", "first_name": "Mandeep", "employee_id": "DL0082", "designation": "Sr Media Buyer", "department": "Marketing", "join_date": "2024-08-12", "years": 2 }
  ]
}
```

### 3. Import the workflow into n8n

Two workflow files ship in this folder:

- `hrms-celebrations-to-slack.json` — uses **n8n Variables**
  (`$env.HRMS_BASE_URL`, `$env.HRMS_WEBHOOK_TOKEN`).
  **Requires Enterprise / self-hosted with `.env` access.**
- `hrms-celebrations-to-slack-no-vars.json` — hardcoded URL + a
  placeholder token in the node. **Works on every n8n plan
  (Free / Starter / Pro / self-hosted).**

Pick the one that fits your plan.

**With Variables (Enterprise / self-hosted):**

1. n8n → **Workflows → Import from File** → pick
   `hrms-celebrations-to-slack.json`
2. Set two n8n environment variables (Settings → Variables, or on your
   n8n instance's `.env`):
   - `HRMS_BASE_URL` = `https://hr.digitalleapmarketing.com`
   - `HRMS_WEBHOOK_TOKEN` = same value you set on Vercel
3. Open the **Post to #general** node → connect your Slack credential
   (OAuth or bot token). Confirm the channel name matches your
   workspace — the default is `general`.
4. Toggle the workflow **Active** in the top-right.

**Without Variables (any n8n plan):**

1. Import `hrms-celebrations-to-slack-no-vars.json`
2. Open the **Fetch today's celebrations** node → replace
   `PASTE_YOUR_WEBHOOK_TOKEN_HERE` in the token field with your real
   token. If HRMS is deployed at a different URL, update the URL too.
3. Open the **Post to #general** node → connect your Slack credential.
4. Save the workflow. Toggle **Active**.

The token now lives inside the workflow JSON. That's acceptable for a
private internal tool — n8n workflows aren't exposed to end users and
the token only grants read access to today's birthday/anniversary
list (no PII beyond names + departments). If you ever export /
share the workflow, blank out the token first.

**Alternative — n8n Credentials (cleanest, still no Enterprise):**
Instead of pasting into the URL field, create an **HTTP Query Auth**
credential in n8n named "HRMS webhook token" with parameter name
`token` and paste the token as the value. In the HTTP Request node,
switch **Authentication** to **Generic Credential Type → Query Auth**
and pick the credential. Same result, token lives in the credentials
store instead of the workflow body — encrypted at rest, and doesn't
show up in workflow JSON exports.

### 4. Test it

Click **Execute Workflow** on the workflow canvas — it runs immediately
regardless of the schedule. If today has no birthdays/anniversaries,
the Code node returns `[]` and the Slack node is skipped (no empty
message posted). To test the Slack side, temporarily change the SQL
predicates in the endpoint or set a test employee's DOB to today.

## What runs when

- **Cron:** every day at 09:00 IST (`0 30 3 * * *` in UTC)
- **Timezone:** set on the workflow to Asia/Kolkata — if you self-host
  n8n in another region, this keeps the trigger anchored to India time
- **Silent days:** the Code node short-circuits when both arrays are
  empty, so nothing hits Slack on ordinary days

## Extending it

- **Different channel per department:** add a Switch node between the
  Code node and Slack to route based on `department`
- **DM the person on their birthday:** add a second branch that DMs the
  employee using their email (add `email` to the endpoint's SELECT)
- **Manager mention:** add `reporting_manager_id` → resolve to Slack
  handle → mention them in the message

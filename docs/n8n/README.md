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

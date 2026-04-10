# Manoa

Manoa is a paid calendar assistant people use by text message.

This repo is now a real MVP scaffold:

- Next.js landing page with working SMS demo
- Stripe Checkout subscription route
- Stripe webhook route for subscription status
- Supabase-backed profiles, subscriptions, calendar connections, business contacts, SMS logs, pending actions, and reminders
- Twilio inbound SMS webhook
- Google Calendar OAuth connection
- Google Calendar agenda, schedule, reschedule, cancel, and reminder hooks

## Product Rules

The intended assistant behavior is documented in:

- `docs/manoa-behavior-spec.md`
- `docs/manoa-scenario-matrix.md`
- `docs/manoa-cost-tracker.md`
- `docs/vercel-deploy-checklist.md`

This is the contract for how Manoa should handle scheduling, rescheduling,
cancellations, reminders, daily agenda texts, attendee notifications, and
calendar-only changes for things like doctor appointments.

The safe external-appointment version should:

- suggest open times before the user calls
- move the user's reminder or temporary hold
- draft a text or call note
- offer `call with me` later
- avoid pretending the office already changed the appointment

## Run Locally

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and fill in the values.

```sh
cp .env.example .env.local
```

Apply the Supabase schema:

```sh
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
```

If you already applied an earlier schema version, also run the external
appointments migration:

```sh
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260408_external_appointments.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260408_authority_and_compliance.sql
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260409_people_contacts_and_invites.sql
```

## Core Routes

- `POST /api/start-checkout`: creates or updates a Supabase profile and redirects to Stripe Checkout
- `POST /api/stripe/webhook`: verifies Stripe webhooks and updates subscription state
- `POST /api/twilio/inbound`: verifies Twilio, checks subscription/calendar state, and routes SMS commands
- `GET /api/calendar/google/start?profile_id=...`: starts Google Calendar OAuth
- `GET /api/calendar/google/callback`: stores Google OAuth tokens
- `GET` or `POST /api/jobs/morning-agenda`: sends morning agenda texts
- `GET` or `POST /api/jobs/reminders`: sends queued reminder texts

## Deploy On Vercel

Use Vercel for the first deployment. The build command is:

```sh
npm run build
```

Add every value from `.env.example` to the Vercel project environment variables. Set `NEXT_PUBLIC_APP_URL` to the live Vercel URL or custom domain, for example:

```sh
NEXT_PUBLIC_APP_URL=https://your-domain.com
GOOGLE_REDIRECT_URI=https://your-domain.com/api/calendar/google/callback
```

After deployment, point the external services at the production routes:

- Stripe webhook: `https://your-domain.com/api/stripe/webhook`
- Twilio inbound SMS webhook: `https://your-domain.com/api/twilio/inbound`
- Google OAuth redirect URI: `https://your-domain.com/api/calendar/google/callback`

The job routes are ready for Vercel Cron because they support `GET`. Set `CRON_SECRET` in Vercel before turning on cron jobs so Vercel sends the `Authorization: Bearer ...` header.

Recommended cron setup:

- Morning agendas: once per day, for example `0 13 * * *` for 8:00 AM Central during daylight saving time.
- Reminders: every 5 or 10 minutes once this is on Vercel Pro, or use an external cron service while staying on Hobby.

Vercel Hobby allows daily cron jobs, but more frequent cron schedules can fail deployment. Reminders need a frequent schedule to feel real.

## SMS Flow

1. Customer signs up with email and phone.
2. Stripe Checkout creates the subscription.
3. Stripe webhook stores `active` or `trialing` subscription status.
4. Customer connects Google Calendar.
5. Twilio sends inbound texts to `/api/twilio/inbound`.
6. Backend normalizes `From`, finds the Supabase profile, checks subscription, checks calendar connection, then processes the text.
7. If Manoa offers options, they are stored in `pending_actions`.
8. Customer replies `1`, `2`, or `3`; the backend books or reschedules the calendar event.

## Optional AI Understanding

If you set `OPENAI_API_KEY`, Manoa will use the OpenAI Responses API as the
text-understanding layer before falling back to the local rule parser. The
backend still owns the safety checks and actual calendar writes.

Recommended env values:

```sh
OPENAI_API_KEY=...
OPENAI_SMS_MODEL=gpt-5.4-mini
```

## Supported MVP Commands

- `9am meeting Tuesday on work calendar`
- `schedule lunch tomorrow`
- `what's on my calendar today?`
- `what's on my calendar tomorrow?`
- `reschedule dentist` -> safe call-prep flow with open times from your calendar
- `reschedule my meeting` -> personal, owned, invited, and external events now branch differently
- `cancel dentist` -> safe note/number flow without pretending the office canceled it
- `book budget review with Sam and Priya Tuesday at 2pm` -> invite known contacts and ask for missing emails once
- `STOP`, `START`, and `HELP`

## Notes

- Start with Google Calendar only. Add Outlook after this flow works end to end.
- Apple/iCloud Calendar should come later because onboarding is less seamless than Google or Outlook.
- The AI layer now optionally assists `src/lib/sms/parser.ts`, but the backend still owns subscription checks, calendar writes, pending options, and reminders.

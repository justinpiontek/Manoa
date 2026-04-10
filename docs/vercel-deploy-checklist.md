# Vercel Deploy Checklist

Last updated: April 9, 2026

Use this when Manoa is ready to go live on Vercel.

## Before deploy

- Make sure the app builds locally with `npm run build`
- Make sure `.env.local` has working values
- Make sure the legal pages exist:
  - `/privacy`
  - `/terms`

## Environment variables to add in Vercel

Add every value from `.env.example`, plus:

- `NEXT_PUBLIC_APP_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MONTHLY_PRICE_ID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_MESSAGING_SERVICE_SID` if used
- `TWILIO_FROM_NUMBER`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `DEFAULT_TIMEZONE`
- `CRON_SECRET`

## Vercel values to use

Set:

- `NEXT_PUBLIC_APP_URL=https://your-vercel-url.vercel.app`
- `GOOGLE_REDIRECT_URI=https://your-vercel-url.vercel.app/api/calendar/google/callback`

If a custom domain is added later, replace the Vercel URL with the custom domain.

## After deploy

### Stripe

- Set the Stripe webhook endpoint to:
  - `https://your-vercel-url.vercel.app/api/stripe/webhook`
- Copy the webhook signing secret into:
  - `STRIPE_WEBHOOK_SECRET`

### Twilio

- Set the inbound SMS webhook to:
  - `https://your-vercel-url.vercel.app/api/twilio/inbound`
- If using a Messaging Service, attach the phone number there
- Finish A2P campaign setup and connect the number to the approved campaign

### Google

- Add this authorized redirect URI in Google Cloud:
  - `https://your-vercel-url.vercel.app/api/calendar/google/callback`

## Cron jobs

Use these routes:

- Morning agenda:
  - `GET /api/jobs/morning-agenda`
- Reminders:
  - `GET /api/jobs/reminders`

Recommended setup:

- Morning agenda: once per day
- Reminders: every 5 or 10 minutes on Vercel Pro

## First live test

1. Open the live site
2. Submit signup with email and phone
3. Complete Stripe checkout
4. Connect Google Calendar
5. Confirm Stripe webhook updates the subscription
6. Confirm Twilio inbound webhook is set
7. Send a real text to Manoa
8. Test:
   - scheduling
   - agenda
   - rescheduling
   - external appointment call-prep flow
   - STOP / START / HELP

## Known good links

- Privacy:
  - `https://your-vercel-url.vercel.app/privacy`
- Terms:
  - `https://your-vercel-url.vercel.app/terms`

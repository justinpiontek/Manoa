# Manoa Launch Readiness Checklist

This is the practical list to work through before pushing Manoa hard.

The goal is simple:

- a new user can sign up
- pay
- connect a calendar
- get back into the dashboard
- send a first text
- trust the product enough to keep using it

## 1. Core Product Flow

### Signup and billing

- [ ] Homepage clearly explains what Manoa does in under 10 seconds
- [ ] Signup form works cleanly on desktop and mobile
- [ ] Stripe payment link works end to end
- [ ] Stripe success redirect lands in the right place
- [ ] Stripe webhook marks subscription as active reliably
- [ ] Billing portal opens correctly from the dashboard
- [ ] Cancel flow works and status updates correctly

### Login and account access

- [ ] Magic-link login sends reliably
- [ ] Magic link lands in the dashboard, not the homepage
- [ ] Login works on both `www.textmanoa.com` and production host setup
- [ ] Sign out works
- [ ] Dashboard access never depends on fragile local state
- [ ] Custom SMTP is connected for production auth emails

### Calendar onboarding

- [ ] Google connect works end to end
- [ ] Reconnect works
- [ ] Disconnect works
- [ ] Remove calendar from Manoa works
- [ ] Multi-calendar settings save reliably
- [ ] Second Google account can connect cleanly
- [ ] Outlook path is either:
  - [ ] tested and trusted enough to show
  - or
  - [ ] hidden/de-emphasized until ready

## 2. Texting Readiness

### Twilio

- [ ] A2P campaign approved
- [ ] Twilio number is attached to the correct Messaging Service
- [ ] Inbound webhook points to:
  - `https://www.textmanoa.com/api/twilio/inbound`
- [ ] `TWILIO_FROM_NUMBER` is set in Vercel
- [ ] Dashboard shows the real Manoa number
- [ ] STOP / START / HELP work correctly

### First live text

- [ ] Manoa recognizes the saved user phone number
- [ ] First text gets a useful reply immediately
- [ ] Numbered options are easy to scan
- [ ] Booking works
- [ ] Rescheduling works
- [ ] Cancel flow works
- [ ] Daily agenda text reads in time order
- [ ] Reminder text sends on time

## 3. Safety and Trust

### Calendar integrity

- [ ] New events do not silently land on the wrong calendar
- [ ] Manoa checks all selected calendars for conflicts
- [ ] Pending invite logic behaves correctly
- [ ] Office appointment flows stay truthful
- [ ] Recurring event behavior feels safe enough to trust

### Token and account safety

- [ ] `CALENDAR_TOKEN_ENCRYPTION_KEY` is set in Vercel
- [ ] New provider tokens are stored encrypted
- [ ] Old plaintext tokens are not required for new connections
- [ ] Google app configuration is stable
- [ ] Outlook app setup is safe enough for real users or clearly not launched yet

### Legal / trust surfaces

- [ ] Privacy Policy is live
- [ ] Terms are live
- [ ] Dashboard feels official and trustworthy
- [ ] Login email looks like a real product email
- [ ] Contact-save flow works

## 4. Website and Conversion

### Homepage

- [ ] Hero explains the value clearly
- [ ] Example text thread looks real
- [ ] CTA is clear
- [ ] Mobile layout feels polished
- [ ] Pricing card feels trustworthy

### SEO basics

- [ ] Metadata is set on homepage
- [ ] Use-case pages have distinct titles/descriptions
- [ ] Sitemap includes the main pages
- [ ] Use-case internal links work
- [ ] No obviously duplicate or thin SEO pages are live

## 5. Dashboard Clarity

- [ ] Status area is easy to understand
- [ ] No repeated account details everywhere
- [ ] The right next action is obvious
- [ ] The number to text is prominent
- [ ] Calendar controls feel responsive
- [ ] Buttons show loading correctly
- [ ] Success/error messages are understandable

## 6. Launch Testing

Before any real push, do at least these real tests:

### Test account 1

- [ ] Sign up
- [ ] Pay
- [ ] Connect Google
- [ ] Log in again with magic link
- [ ] Save Manoa contact
- [ ] Send first text
- [ ] Book an event
- [ ] Reschedule an event
- [ ] Cancel an event

### Test account 2

- [ ] Multi-calendar setup
- [ ] Calendar naming/routing
- [ ] Conflict checking across calendars
- [ ] Pending invite handling

### Test account 3

- [ ] Full mobile-only flow
- [ ] Login link from phone
- [ ] Dashboard on mobile
- [ ] First text from phone

## 7. First Tester Prep

Before inviting real outside testers:

- [ ] 5 to 10 early testers identified
- [ ] Simple onboarding message drafted
- [ ] Support fallback ready if someone gets stuck
- [ ] One short founder demo video ready
- [ ] One testimonial request ready for happy testers

## 8. Go / No-Go Launch Call

Do not push hard yet if any of these are still shaky:

- auth emails are flaky
- dashboard access is flaky
- Twilio approval is not done
- first text does not feel reliable
- billing state is confusing
- calendar connect or reconnect is still error-prone

You are ready to push when:

- the product feels trustworthy
- the first-use flow feels short
- the first successful text is satisfying
- you are not nervous about a stranger trying it

## Recommended Order From Here

### Before Twilio approval

1. finish custom SMTP
2. finish Google trust/publishing details
3. keep tightening dashboard and onboarding
4. finish real launch test checklist
5. line up early testers

### As soon as Twilio approval lands

1. run the full live texting test
2. onboard first testers manually
3. fix any first-week confusion fast
4. collect testimonials
5. begin controlled outreach

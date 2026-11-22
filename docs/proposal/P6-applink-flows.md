# Proposal page 6: How Uposhom uses Applink (four flows)

_Draft by workstream A. Everyone reviews this page against the real flows before it is submitted.
Figures in square brackets are placeholders until decided with the mentor._

Uposhom uses four Applink APIs: **OTP, SMS, Subscription and CaaS**. The phone app never talks to
Applink: it talks to our own API, and our server (on a fixed, allow-listed IP) calls Applink.
Applink is used to _start_ something, never to log a person in: after the first sign-up, every
request is authenticated by our own short-lived token, so an elderly user is never pushed into a
paid code just because a session expired.

## Flow 1: Sign-up with a one-time code (OTP)

1. The person enters their mobile number. A screen first says what they are joining, including any
   charge, and we record that they saw it **before** asking Applink to send a code.
2. We call **OTP request**; Applink texts the code. We keep Applink's reference number on the server
   only. The code is valid for five minutes, and we enforce that ourselves, cap attempts at five, and
   rate-limit requests per number and per address so the endpoint cannot be used to spam strangers.
3. The person types the code. We call **OTP verify** with the stored reference. Applink returns an
   opaque subscriber id: the key for every later message and callback. We store it exactly as given.
4. We issue our own session (15-minute access token, 90-day rotating refresh token). The same OTP
   flow, as a **step-up**, re-proves the phone before sensitive actions such as deleting an account.
   A sign-up code and a step-up code cannot be used for each other.

## Flow 2: Reminders and replies by SMS (SMS)

- **Outbound:** every reminder is a queued job. The message is logged by identifiers and status only,
  never its text. A message is never sent twice (idempotency key), a timeout is never blindly
  retried, and only temporary Applink errors are retried, with a limit. Sends are spaced to Applink's
  per-second ceiling.
- **Inbound replies:** the person texts the keyword and a code (`UPOSHOM 1` taken, `2` snooze, `3`
  skip). A reply can only record a dose or opt out. It can never start a payment, subscribe anyone or
  delete anything, because an inbound SMS is only authenticated by its sender address.
- **STOP, UNSUB, OFF:** honoured for anyone, at once. Messages already queued for that number are
  skipped when they come up, and Applink Unregister is retried until it takes.
- **Delivery reports:** matched to the message we sent; reports that arrive late, twice, or out of
  order never move a message backwards. Three failures in a row mark a number as unreachable.

## Flow 3: Premium plan (Subscription)

- The upgrade screen shows the price, that it renews monthly, and how to cancel. The person's
  agreement (exact wording, amount, currency, frequency, time, device address) is stored **before**
  we call Applink Register.
- Applink confirms asynchronously through the **subscriber notification**. We never trust a
  notification on its own: Premium is unlocked only when we hold _all three_ of an active
  subscription, a recorded consent for the plan, and a Register call we made ourselves. The free
  sign-up in Flow 1 already shows as "registered" at Applink, and it does **not** unlock Premium.
- Reading status costs nothing: it comes from our own copy, kept fresh by notifications and a nightly
  check against Applink. A billing failure keeps the account and shows how to fix payment.
- Cancelling closes Premium immediately, stops messages, and ends the subscription at Applink.

## Flow 4: Pay-per-use charges (CaaS, two steps and a callback)

For an extra scan or a doctor summary ([5.00 BDT], set on the server, never sent by the app):

1. **Ledger first.** We write the charge to our ledger and the person's agreement to the price, then
   call Applink to send a payment code. This step charges nothing.
2. The person enters the code. We call Applink to submit the payment, using the reference Applink
   gave us in step 1.
3. **Only Applink's charging notification settles it.** We fulfil only when the notification says
   success, the amount paid covers the price, and nothing is still owed. A partial payment is
   recorded and waits for the rest. Each charge grants its credit exactly once, however many
   notifications arrive.

We never re-run step 1 to retry step 2, we never start a second charge for the same payment, and a
timeout is never retried: a reconciliation job closes unused codes and alerts a human about any
payment that was submitted but never confirmed.

## How we know it works

- A local copy of Applink checks every request we build against the published contract.
- Automated tests cover each flow end to end, including: wrong and expired codes, partial then full
  payment, duplicate and out-of-order callbacks, timeouts, and a person deleting their account in the
  middle of a payment.
- An automated audit runs a whole session and checks that no phone number, code, token, password or
  message text appears in any log.
- Callbacks are always acknowledged immediately and processed afterwards, so Applink never retries a
  payload because of us.

## What Applink gives the person

Reminders and replies that work on a plain phone; a payment they can see and approve each time, with
a code only they hold; and an opt-out in every channel (STOP by SMS, a button in the app) that takes
effect immediately.

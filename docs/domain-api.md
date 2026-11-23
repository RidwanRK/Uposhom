# Domain API (workstream B)

What the app can call for circles, prescriptions, doses, reminders and caregivers. Shapes are the
zod schemas in `packages/shared`; run it locally with `pnpm dev:local` (see `local-backend.md`).
All paths are under `/api/v1` and need a signed-in user.

## Circle and profiles

| Endpoint                              | Notes                                                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /circles`                        | The first call creates the circle and the user's own profile (`relationship: SELF`). Each profile lists its `links`. Open invites for the user's number are accepted here. |
| `POST /profiles`, `PUT /profiles/:id` | Free allows only the own profile: adding one answers `402 PAYMENT_REQUIRED`, message `PREMIUM`. Meal times must run morning < noon < evening < night (`MEAL_TIME_ORDER`).  |

## Prescriptions and doses

| Endpoint                            | Notes                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /prescriptions/:id/confirm`   | `new` as the id for a typed-in prescription. Unschedulable items answer `422 NEEDS_MANUAL_INPUT` with `details: [{ index, reasons }]`, and nothing is saved.                                    |
| `GET /doses/today?profileId=&days=` | From today's midnight in Dhaka for `days` days (1 to 14). A snoozed dose keeps its `dueAt`.                                                                                                     |
| `POST /doses/:id/action`            | `409 DOSE_NOT_DUE` more than 2 hours early, `409 DOSE_CLOSED` once taken or skipped. Taken more than 30 minutes late is `TAKEN_LATE`. Notifee buttons may send `X-Action-Source: notification`. |

SMS replies (`UPOSHOM 1`, `2`, `3`, Bangla digits too) act on the latest dose due in the last 6 hours.

## Reminders and escalation

Every minute (`job.doses.ladder`): an SMS at the due time and a repeat 15 minutes later. At 30
minutes a non-critical dose is `MISSED`; a critical one alerts the caregivers (Premium only) by SMS
and push. At 50 the secondary caregiver; at 70 it is `MISSED`. A snooze restarts this from the end
of the snooze. A bounced reminder for a critical dose alerts the caregivers at once.

| Endpoint                      | Notes                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET /alerts`                 | The caregiver's inbox: alerts sent to them in the last week, one per dose.                                       |
| `POST /doses/:id/acknowledge` | A caregiver saw it: no secondary alert follows.                                                                  |
| `POST /devices`               | `{ expoPushToken, platform }` after sign-in. Push data: `{ type: 'CAREGIVER_ALERT', doseId, profileId, level }`. |

## Follow-ups, refills and the weekly digest

| Endpoint                                           | Notes                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /profiles/:id/appointments { title, dueAt }` | `dueAt` is ISO with an offset, in the future. Answers `201 { id, title, dueAt, reminderState }`. Not in `packages/shared` yet. |
| `GET /profiles/:id/appointments`                   | `{ appointments: [...] }`, from yesterday on, soonest first.                                                                   |

Jobs, all safe to re-run: refill reminders daily at 09:00 (SMS to the patient and an inbox notice, two days before the pills run out); follow-up reminders within 24 hours of the appointment (SMS and notice, once); the weekly digest on Friday at 20:00 (notice and push to caregivers, not the patient). These notices appear in `GET /alerts` as `REFILL_DUE`, `FOLLOW_UP` and `WEEKLY_DIGEST`.

## Admin agent traces

`GET /admin/traces?limit=` (1 to 200, default 50): admins only, checked on the account, and every read goes to `audit_log`. For workstream C, `app.domain.recordTrace({ channel, rootAgent, inputPreview?, handoffs, toolCalls, durationMs, userId?, profileId? })` writes one row per agent run; the preview is cut to 120 characters and should hold no names or numbers.

## Family members

| Endpoint                                           | Notes                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /links { profileId, msisdn, role }`          | Admins only. Becomes a link when that person next signs in and loads `GET /circles`. Lasts 7 days. |
| `PUT /links/:id { role }`                          | Admins only.                                                                                       |
| `DELETE /links/:id`                                | Needs `X-Step-Up-Token`. An admin removes someone, or anyone leaves.                               |
| `PUT /profiles/:id/secondary-caregiver { linkId }` | Who gets the T+50 alert: a caregiver or admin who is not the patient.                              |

Errors: `ALREADY_LINKED`, `LAST_ADMIN`, `OWN_PROFILE`, `LIMIT_REACHED` (10 people per profile), and
`INVALID_INPUT` with message `MSISDN`, `SELF`, `NOT_A_CAREGIVER` or `PUSH_TOKEN`.

Not built yet: Family Link (OTP to a dependent's own phone).

## Scans, reports, journal, voice, insights, drugs, pharmacies, settings

These call workstream C's `packages/ai` (OpenRouter). Without `OPENROUTER_API_KEY` they answer
with C's built-in samples, so they work locally; on the server the key in `.env` makes them real.

| Endpoint                                                                               | Notes                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /prescriptions/upload-and-parse` (multipart `file`)                              | Image only. Saves a DRAFT; confirm it with `POST /prescriptions/:draftId/confirm`. Uses the scan quota: `402 PAYMENT_REQUIRED`, message `SCAN`. |
| `POST /reports/upload-and-parse` (multipart `file`)                                    | Image only. Saved in the report vault.                                                                                                          |
| `GET /reports?profileId=`, `GET /reports/:id`                                          | A caregiver opening a report is written to `audit_log`.                                                                                         |
| `POST /symptoms/journal`                                                               | C's journal with the red-flag guard first. A finished journal is kept; its summary id is used by the doctor summary.                            |
| `POST /summaries/doctor`                                                               | Premium, or a paid credit: otherwise `402 PAYMENT_REQUIRED`, message `DOCTOR_SUMMARY`.                                                          |
| `POST /voice/transcribe` (multipart `audio`), `POST /voice/query`                      | The query answers from that profile's real doses and is traced for the admin screen.                                                            |
| `GET /insights/:profileId`                                                             | Patterns are locked on Free.                                                                                                                    |
| `GET /drugs/search?q=`, `GET /drugs/generics?brand=`                                   | DGDA catalogue, Latin or Bangla.                                                                                                                |
| `GET /pharmacies?lat=&lng=&area=&drugId=&radiusKm=`                                    | Pharmacy accounts' stores plus C's partner list; stock only as owners set it.                                                                   |
| `GET /pharmacies/me`, `PUT /pharmacies/me/profile`, `PUT /pharmacies/me/stock/:drugId` | Pharmacy accounts only (`403` otherwise).                                                                                                       |
| `GET` / `PUT /account/settings`                                                        | `smsReminders: false` stops reminder SMS (the phone's alarm still rings); `discreetSms` leaves medicine names out of SMS.                       |

Uploads are limited to 8 MB. Photos are not stored yet (no object storage).

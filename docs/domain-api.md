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

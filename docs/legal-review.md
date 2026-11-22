# Terms, privacy and support: what the team must confirm before publishing

The public pages are served by the API at `/legal/terms`, `/legal/privacy` and `/support`
(`apps/api/src/routes/legal.ts`). The text is a working draft written by workstream A from what the
system actually does. Prices, retention periods and the SMS keyword are filled in from the live
configuration, so those cannot drift from the code. Everything below needs a human decision.

## Must be done before registering with Applink

- [ ] Set `SUPPORT_EMAIL` and `SUPPORT_PHONE` in `/opt/uposhom/.env`. Applink checks for a published
      support contact. Without them the pages say "the support contact listed in the app".
- [ ] Put the three URLs in the Applink portal application description:
      `https://<domain>/legal/terms`, `/legal/privacy`, `/support`.
- [ ] Someone with legal sense reads both pages. This is not legal advice and nobody has reviewed it.

## Needs another workstream's input

- [ ] **Privacy section 1** ends with "[Detailed handling of this information is described by the
      app team.]" for prescriptions, reports and symptom notes. B/C/D: state where images and
      reports are stored, for how long, who can see them, and what happens on delete. Then remove the
      bracket.
- [ ] **Privacy section 3** has "[To be confirmed by the AI team before publishing.]" for providers
      that read prescription images and write explanations. C: confirm that OpenRouter and the model
      providers are the only recipients, and whether images are retained by them.
- [ ] Remove both brackets: a published page must not contain them.
- [ ] A Bangla version. The app is Bangla-first and the pages are English only. Have a native
      speaker translate it; do not machine-translate legal text.

## Decisions that change the wording

- [ ] **Prices** are placeholders (`PLAN_FAMILY_CIRCLE_AMOUNT`, `CAAS_AMOUNT_*`). Decide them with the
      mentor, set them in `.env`; the pages update themselves. Applink questions amounts that look
      unfair, so be ready to defend them.
- [ ] **Cancelling the paid plan also ends reminder SMS**, because Applink holds one subscription per
      subscriber and our unsubscribe ends it. The terms say so. If Applink confirms OTP sign-up and
      the paid plans are separate applications, this changes: re-read section 4 of the terms.
- [ ] **Data deletion keeps two things:** a STOP entry (the opaque subscriber id only) so the number
      is never messaged again, and the payment ledger without any link to the person. The privacy
      policy does not yet say this. Add a sentence under "Your choices" once the team agrees.
- [ ] **Governing law:** the terms say the laws of Bangladesh. Confirm.
- [ ] **Operator charges:** the terms say standard operator terms apply to SMS. Confirm with Applink
      whether recipients pay for reminders.

## When any of this changes

Update `lastUpdated` in `buildApp` (`apps/api/src/app.ts`) so both pages show the new date, and tell
users in the app about important changes.

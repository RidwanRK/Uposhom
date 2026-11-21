# উপশম (Uposhom) — Bangla-First Personal Healthcare Organiser

An Android app (React Native) designed to simplify medication adherence, medical record management, and preventive health tracking for native Bangla-speaking households.

## 🚀 Getting Started (developers)

Requires Node.js 22 and pnpm 9 or newer.

```bash
pnpm install              # whole monorepo (node-linker=hoisted for Metro)
cp .env.example .env      # placeholders only; real values never go in git
pnpm dev                  # API on http://localhost:3000, check /healthz
pnpm typecheck && pnpm lint && pnpm test
```

Layout: `apps/{api,worker,mobile}`, `packages/{schedule-engine,applink-client,ai,shared,db}`, `data/`,
`scripts/`, `deploy/`. See `Master_Plan.md` section 4.1 for the full tree and section 19 for CI/CD
and hosting. Workflow is trunk-based: short branches, PR into `main`, CI must pass, and every merge
to `main` redeploys the live VM.

## 🎯 Problem & Solution

* **Routine Complexity:** Simplifies multi-medicine tracking, lab reports, and follow-ups—especially for elderly dependents—via a unified **Family Circle** admin account.
* **Language Barriers:** Translates English medical shorthand (e.g., `1+0+1 BDPC`) and lab metrics into clear, everyday Bangla using OCR and AI.
* **Price & Stock Visibility:** Matches medicines against a hand-verified drug table built from DGDA-published data to show same-ingredient alternatives and indicative prices, and locates nearby pharmacy stock.

## ✨ Core Features

* **Prescription OCR & Bangla Translation:** Scans printed/handwritten prescriptions, extracts dosages, and translates instructions into plain Bangla.
* **Automated Scheduling & SMS Alerts:** Converts verified prescriptions into daily schedules with push notifications and SMS reminders.
* **Caregiver Escalation Alerts:** Alerts family caregivers (push and SMS) when a dependent still has not acted 30 minutes after a critical dose was due, and a secondary caregiver 20 minutes later if no one acknowledges.
* **Diagnostic Report Vault:** Encrypted storage for lab reports with simplified Bangla explanations of out-of-range metrics.
* **AI Symptoms Journaling & Doctor Summary:** Logs symptoms via text or Bangla voice and uses follow-up Q&A to generate structured summaries for doctor visits.
* **AI Sickness History:** Combines symptom logs and past prescriptions to detect recurring illness patterns and offer preventive lifestyle tips, shown on an in-app Insights screen.
* **Generic Drug Finder & Pharmacy Discovery:** Suggests lower-priced alternatives with the same ingredient, strength and form (indicative prices; a doctor or pharmacist confirms any substitution) and lists nearby pharmacies whose owners have marked them in stock.
* **Bangla Voice Support:** Hands-free spoken Bangla input for symptom logging and schedule questions ("what is my next medicine?"), with the answer read aloud, for elderly or low-literacy users.
* **USSD & SMS Access:** Feature-phone menu (`*195#`) and SMS reply codes sent with the shortcode keyword (`UPOSHOM 1` taken, `UPOSHOM 2` snooze, `UPOSHOM 3` skip) for users without smartphones or data.
* **Health Advice Carousel:** Auto-swiping homepage tips on medicine storage and safe usage.

## 💳 Tiers & Pricing Model

| Feature | Free (Individual) | Premium (Family Circle) | B2B Partner (Pharmacy) |
| :--- | :--- | :--- | :--- |
| **Profiles** | Single User | Up to 6 Dependents | Separate Pharmacy account (one store) |
| **OCR & Translation** | Basic (Limited) | Unlimited | N/A |
| **Reminders & Alerts** | App & Standard SMS | Priority SMS + Caregiver Escalation | N/A |
| **Report Vault** | Basic Quota | Unlimited Cloud Vault | N/A |
| **Health Insights** | Basic Logs | AI Pattern Recognition & Doctor Summary | N/A |
| **Pharmacy Listing** | Standard | Standard | Priority Top Placement + Featured Stock |

## 🏗️ System Architecture

```text
[ Layer 1: Client Layer (React Native, Android) ]
                       │
                       ▼
[ Layer 2: API Gateway & Core Backend Services ]
       │               │               │
       ▼               ▼               ▼
[ Layer 3: AI ] [ Layer 4: Rules ] [ Layer 6: Applink APIs ]
       │               │               │
       └───────────────┼───────────────┘
                       ▼
[ Layer 5: Database & Cloud Storage Layer ]
```

1. **Client Layer:** Android-only app (Bangla-optimized). Pharmacies use a separate Pharmacy account type in the same app. No web portal, no iOS.
2. **API Gateway & Backend:** Handles auth, Role-Based Access Control (Individual, Family Admin, B2B), and routing.
3. **AI Pipeline:** Vision-model text extraction and JSON structuring through OpenRouter, multi-agent Bangla assistant (OpenAI Agents SDK), and Bangla Speech-to-Text.
4. **Deterministic Rule Engine:** Non-AI TypeScript package plus pg-boss worker that computes exact reminder timestamps and escalation rules.
5. **Data & Storage:** PostgreSQL for schedules/users and encrypted Cloudflare R2 object storage for medical scans.
6. **Applink Telecom APIs:** Carrier integration for OTPs, SMS alerts, USSD, and airtime micro-billing (backend only).

> **Sign-up:** Anyone can create an account with any Bangladeshi mobile number. A number Applink rejects sees a clear message at sign-up instead of a silent failure, and during Limited Production only whitelisted test numbers can sign up. Plans are billed to the mobile account (prepaid is debited, postpaid is added to the bill).

## 🛡️ AI Safety Guardrail

```text
[ Prescription Image ] ──▶ [ Vision model reads image → JSON ] ──▶ [ Validators ] ──▶ [ User Visual Confirmation ] ──▶ [ Deterministic Rule Engine ]
```

* **No AI Scheduling:** AI is strictly prohibited from calculating or altering dosages/schedules.
* **Human-in-the-Loop:** The vision model only reads the photo into structured fields with per-field confidence; deterministic validators then check them. Users must visually confirm the details before passing data to the **100% deterministic rule-based engine** for scheduling.

## 🛠️ Tech Stack

Everything is TypeScript except SQL. The app and the server share zod schemas and types through a pnpm monorepo; the schedule engine runs on the server only.

* **Mobile (Android only):** React Native with Expo (development build, Expo Router), NativeWind, TanStack Query, Zustand, `expo-sqlite` (offline cache), `expo-camera` + `expo-image-picker` + `expo-image-manipulator` (prescription capture), Reanimated + Gesture Handler (swipe-to-confirm), Notifee (exact-alarm reminders with Taken/Snooze/Skip buttons), Expo Push (caregiver alerts), `expo-audio` + `expo-speech` (voice), `expo-secure-store`, `expo-haptics`, `expo-location`, `expo-print` + `expo-sharing` (doctor summary PDF), Noto Sans Bengali
* **Backend:** Node.js 22 LTS with Fastify (TypeScript, zod validation)
* **Worker:** pg-boss on Postgres (reminders, escalation ladder, SMS queue, reconciliation, digests)
* **Database:** PostgreSQL 16, self-hosted in Docker on the VM, with Drizzle ORM. `pg_trgm` powers drug-name search (Latin names, plus a Bangla name and aliases column for Bangla input). No Redis.
* **Storage:** Cloudflare R2 (encrypted object storage for prescription and report images)
* **AI:** `@openai/agents` through OpenRouter (`google/gemini-2.5-flash` for vision and agents, `qwen/qwen2.5-vl-72b-instruct` fallback); Bangla speech-to-text chosen in a Day 1 spike (Whisper or Gemini audio)
* **Telecom & Billing:** Applink APIs (OTP, SMS, USSD, Subscription, CaaS), called from the backend only
* **Hosting & CI:** One free always-on VM with a fixed IPv4 (Oracle Cloud Always Free first, Google Cloud e2-micro as the free fallback) running Docker Compose (API, worker, Postgres) behind Caddy. GitHub Actions builds the images into GHCR, deploys over SSH, and builds the APK, which is published as a public GitHub Release asset. Nothing is compiled on the VM.
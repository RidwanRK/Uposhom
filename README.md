# উপশম (Uposhom) — Bangla-First Personal Healthcare Organiser

A mobile and web platform designed to simplify medication adherence, medical record management, and preventive health tracking for native Bangla-speaking households.

## 🎯 Problem & Solution

* **Routine Complexity:** Simplifies multi-medicine tracking, lab reports, and follow-ups—especially for elderly dependents—via a unified **Family Circle** admin account.
* **Language Barriers:** Translates English medical shorthand (e.g., `1+0+1 BDPC`) and lab metrics into clear, everyday Bangla using OCR and AI.
* **Price & Stock Visibility:** Identifies government-approved generic drug equivalents and locates nearby pharmacy stock.

## ✨ Core Features

* **Prescription OCR & Bangla Translation:** Scans printed/handwritten prescriptions, extracts dosages, and translates instructions into plain Bangla.
* **Automated Scheduling & SMS Alerts:** Converts verified prescriptions into daily schedules with push notifications and SMS reminders.
* **Caregiver Escalation Alerts:** Sends instant alerts to family admins when a dependent misses a critical dose.
* **Diagnostic Report Vault:** Encrypted storage for lab reports with simplified Bangla explanations of out-of-range metrics.
* **AI Symptoms Journaling & Doctor Summary:** Logs symptoms via text or Bangla voice and uses follow-up Q&A to generate structured summaries for doctor visits.
* **AI Sickness History:** Tracks health logs to detect recurring illness patterns and offer preventive lifestyle tips.
* **Generic Drug Finder & Pharmacy Discovery:** Suggests bioequivalent generics and lists nearby pharmacies stocking them.
* **Bangla Voice Support:** Hands-free spoken Bangla input for elderly or low-literacy users.
* **Health Advice Carousel:** Auto-swiping homepage tips on medicine storage and safe usage.

## 💳 Tiers & Pricing Model

| Feature | Free (Individual) | Premium (Family Circle) | B2B Partner (Pharmacy) |
| :--- | :--- | :--- | :--- |
| **Profiles** | Single User | Up to 6 Dependents | Single / Multi-branch |
| **OCR & Translation** | Basic (Limited) | Unlimited | N/A |
| **Reminders & Alerts** | App & Standard SMS | Priority SMS + Caregiver Escalation | N/A |
| **Report Vault** | Basic Quota | Unlimited Cloud Vault | N/A |
| **Health Insights** | Basic Logs | AI Pattern Recognition & Doctor Summary | N/A |
| **Pharmacy Listing** | Standard | Standard | Priority Top Placement + Featured Stock |

## 🏗️ System Architecture

```text
[ Layer 1: Client Layer (Mobile App / Web Portal) ]
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

1. **Client Layer:** Cross-platform mobile app (Bangla-optimized) and B2B pharmacy web portal.
2. **API Gateway & Backend:** Handles auth, Role-Based Access Control (Individual, Family Admin, B2B), and routing.
3. **AI Pipeline:** OCR text extraction, LLM JSON structuring/translation, and Bangla Speech-to-Text.
4. **Deterministic Rule Engine:** Non-AI microservice that computes exact reminder timestamps and escalation rules.
5. **Data & Storage:** Relational DB for schedules/users and HIPAA-compliant encrypted object storage for medical scans.
6. **Applink Telecom APIs:** Carrier integration for OTPs, SMS alerts, and airtime micro-billing.

## 🛡️ AI Safety Guardrail

```text
[ Prescription Image ] ──▶ [ OCR ] ──▶ [ LLM JSON Parsing ] ──▶ [ User Visual Confirmation ] ──▶ [ Deterministic Rule Engine ]
```

* **No AI Scheduling:** AI is strictly prohibited from calculating or altering dosages/schedules.
* **Human-in-the-Loop:** The LLM only parses raw OCR text into structured fields. Users must visually confirm the details before passing data to the **100% deterministic rule-based engine** for scheduling.

## 🛠️ Tech Stack

* **Frontend:** Flutter / React Native (Mobile), React / Next.js (B2B Web)
* **Backend:** Node.js (Express / NestJS) or Python (FastAPI)
* **Database & Cache:** PostgreSQL, Redis
* **Storage:** AWS S3 / Google Cloud Storage (Encrypted)
* **AI & ML:** PaddleOCR / Tesseract, Google Gemini API (Flash) / Gemma / Llama, OpenAI Whisper (Bangla ASR)
* **Telecom & Billing:** Banglalink Applink APIs (OTP, SMS, Subscription)
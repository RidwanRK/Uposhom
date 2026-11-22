/**
 * @uposhom/ai
 *
 * OpenAI Agents SDK + OpenRouter Pipeline for Uposhom.
 * Multi-agent orchestration, deterministic safety guards, prescription vision OCR,
 * report vault parsing, DGDA generic finder, and agent execution telemetry.
 */

// Configuration & Client
export * from './config.js';
export * from './client.js';

// Deterministic Safety Guards
export * from './guards/redflag-guard.js';
export * from './guards/numeric-guard.js';

// Traces & Telemetry
export * from './traces/trace-logger.js';

// Specialist & Router Agents
export * from './agents/emergency-agent.js';
export * from './agents/schedule-agent.js';
export * from './agents/generic-agent.js';
export * from './agents/symptom-agent.js';
export * from './agents/triage-agent.js';

// Vision & Document Intake
export * from './vision/ocr-extract.js';
export * from './vision/report-vault.js';

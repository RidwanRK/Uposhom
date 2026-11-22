/**
 * Emergency Safety Agent
 *
 * Provides immediate life-saving guidance and instructions to contact 999
 * when acute red-flag symptoms are identified.
 */

import { Agent } from '@openai/agents';
import { createOpenRouterAgentModel } from '../client.js';
import { checkRedFlagKeywords, type RedFlagCheckResult } from '../guards/redflag-guard.js';

export const EMERGENCY_AGENT_INSTRUCTIONS = `
আপনি উপশম (Uposhom) এর ইমার্জেন্সি সুরক্ষা অ্যাসিস্ট্যান্ট।
আপনার প্রধান দায়িত্ব হলো ব্যবহারকারীকে শান্ত রাখা এবং তাৎক্ষণিক ৯৯৯ (জরুরি হেল্পলাইন) এ যোগাযোগ করতে অথবা নিকটস্থ জরুরি হাসপাতালে যাওয়ার জন্য সুস্পষ্ট ও জরুরি নির্দেশনা দেওয়া।
কখনোই কোনো রোগ নির্ণয় (diagnosis) বা প্রেসক্রিপশন দেবেন না। রোগীকে দ্রুত হাসপাতালে নিয়ে যাওয়ার উপর গুরুত্ব দিন।
`.trim();

/**
 * Creates the EmergencyAgent instance.
 */
export function createEmergencyAgent(): Agent {
  return new Agent({
    name: 'EmergencyAgent',
    instructions: EMERGENCY_AGENT_INSTRUCTIONS,
    model: createOpenRouterAgentModel(),
  });
}

/**
 * Direct evaluation helper that executes the deterministic red-flag guard
 * and returns the appropriate emergency response without waiting for a model call.
 */
export function handleEmergencyTriage(inputText: string): RedFlagCheckResult {
  return checkRedFlagKeywords(inputText);
}

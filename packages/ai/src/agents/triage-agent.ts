/**
 * Inbound Bangla Triage Router Agent
 *
 * Inspects incoming free-text SMS or spoken voice messages and executes
 * explicit handoffs to specialist agents:
 * - EmergencyAgent (for critical red-flag conditions)
 * - ScheduleQueryAgent (for doses and reminder questions)
 * - GenericFinderAgent (for medicine cost and alternatives questions)
 * - SymptomJournalAgent (for symptom intake and consultation prep)
 */

import { Agent, handoff } from '@openai/agents';
import { createOpenRouterAgentModel } from '../client.js';
import { createEmergencyAgent } from './emergency-agent.js';
import { createScheduleAgent } from './schedule-agent.js';
import { createGenericAgent } from './generic-agent.js';
import { createSymptomAgent } from './symptom-agent.js';
import { checkRedFlagKeywords, type RedFlagCheckResult } from '../guards/redflag-guard.js';

export const TRIAGE_AGENT_INSTRUCTIONS = `
আপনি উপশম (Uposhom) এর মূল ট্রায়াজ ও রাউটার এজেন্ট (TriageAgent)।
আপনার কাজ হলো ব্যবহারকারীর বাংলায় পাঠানো মেসেজ (এসএমএস বা ভয়েস ট্রান্সক্রিপ্ট) বিশ্লেষণ করে সঠিক বিশেষজ্ঞ এজেন্টের কাছে দায়িত্ব হস্তান্তর (Handoff) করা:

১. বুকে ব্যথা, তীব্র শ্বাসকষ্ট, অতিরিক্ত রক্তপাত বা স্ট্রোকের লক্ষণ দেখলে তাৎক্ষণিক EmergencyAgent এ পাঠান।
২. "আজকের ওষুধ কি?", "পরের ওষুধ কখন?", "কখন খাব?" ইত্যাদি সময়সূচী বিষয়ক প্রশ্নে ScheduleQueryAgent এ পাঠান।
৩. "নাপার বদলে কি খাব?", "কম দামি ওষুধ", "বিকল্প ওষুধ" ইত্যাদি প্রশ্নের জন্য GenericFinderAgent এ পাঠান।
৪. "শরীর ভালো লাগছে না", "জ্বর ও মাথাব্যথা করছে", "পেট ব্যথা" ইত্যাদি শারীরিক উপসর্গের বর্ণনায় SymptomJournalAgent এ পাঠান।

বাংলায় বিনীত ও স্পষ্ট ভাষায় কথা বলুন।
`.trim();

export interface MultiAgentSystem {
  triageAgent: Agent;
  emergencyAgent: Agent;
  scheduleAgent: Agent;
  genericAgent: Agent;
  symptomAgent: Agent;
}

/**
 * Creates the complete multi-agent system with configured handoffs.
 */
export function createMultiAgentSystem(): MultiAgentSystem {
  const emergencyAgent = createEmergencyAgent();
  const scheduleAgent = createScheduleAgent();
  const genericAgent = createGenericAgent();
  const symptomAgent = createSymptomAgent();

  const triageAgent = new Agent({
    name: 'TriageAgent',
    instructions: TRIAGE_AGENT_INSTRUCTIONS,
    model: createOpenRouterAgentModel(),
    handoffs: [
      handoff(emergencyAgent),
      handoff(scheduleAgent),
      handoff(genericAgent),
      handoff(symptomAgent),
    ],
  });

  return {
    triageAgent,
    emergencyAgent,
    scheduleAgent,
    genericAgent,
    symptomAgent,
  };
}

/**
 * Deterministic router classifier for zero-latency triage routing.
 */
export function classifyInboundIntent(inputText: string): {
  intent: 'EMERGENCY' | 'SCHEDULE' | 'GENERIC_FINDER' | 'SYMPTOM_JOURNAL' | 'GENERAL';
  targetAgent: 'EmergencyAgent' | 'ScheduleQueryAgent' | 'GenericFinderAgent' | 'SymptomJournalAgent' | 'TriageAgent';
  redFlag?: RedFlagCheckResult;
} {
  const redFlag = checkRedFlagKeywords(inputText);
  if (redFlag.isEmergency) {
    return {
      intent: 'EMERGENCY',
      targetAgent: 'EmergencyAgent',
      redFlag,
    };
  }

  const normalized = inputText.toLowerCase();

  // Schedule query keywords
  const scheduleKeywords = [
    'আজকের ওষুধ',
    'পরের ওষুধ',
    'কখন ওষুধ',
    'কখন খাব',
    'ওষুধের সময়',
    'আজকে কি ওষুধ',
    'next dose',
    'today dose',
    'schedule',
    'কখন খাবো',
  ];
  if (scheduleKeywords.some((k) => normalized.includes(k))) {
    return {
      intent: 'SCHEDULE',
      targetAgent: 'ScheduleQueryAgent',
    };
  }

  // Generic alternative keywords
  const genericKeywords = [
    'বিকল্প',
    'বিকল্প ওষুধ',
    'কম দামের',
    'সাশ্রয়ী',
    'বদলে',
    'জেনেরিক',
    'alternative',
    'generic',
    'substitute',
  ];
  if (genericKeywords.some((k) => normalized.includes(k))) {
    return {
      intent: 'GENERIC_FINDER',
      targetAgent: 'GenericFinderAgent',
    };
  }

  // Symptom keywords
  const symptomKeywords = [
    'ব্যথা',
    'জ্বর',
    'কাশি',
    'বমি',
    'মাথা ঘোরা',
    'দুর্বল',
    'গা গরম',
    'পেট খারাপ',
    'অসুস্থ',
    'symptom',
    'fever',
    'pain',
    'headache',
    'vomit',
  ];
  if (symptomKeywords.some((k) => normalized.includes(k))) {
    return {
      intent: 'SYMPTOM_JOURNAL',
      targetAgent: 'SymptomJournalAgent',
    };
  }

  return {
    intent: 'GENERAL',
    targetAgent: 'TriageAgent',
  };
}

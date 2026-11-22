/**
 * Symptom Journal Agent
 *
 * Conducts an empathetic slot-filling clinical intake Q&A flow:
 * 1. Onset (কখন শুরু হয়েছে)
 * 2. Duration (কতক্ষণ ধরে আছে)
 * 3. Severity (তীব্রতা - মৃদু/মাঝারি/তীব্র)
 * 4. Triggers (কোন কিছুতে বাড়ে বা কমে কি না)
 * 5. Associated symptoms (অন্য কোনো উপসর্গ আছে কি না)
 * 6. Current medicines (বর্তমানে কী ওষুধ খাচ্ছেন)
 *
 * Formats a structured clinical summary for doctor consultations.
 * Strict boundary: NEVER diagnoses or prescribes.
 */

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { createOpenRouterAgentModel } from '../client.js';
import { checkRedFlagKeywords } from '../guards/redflag-guard.js';

export interface SymptomJournalEntry {
  chiefComplaint: string;
  onset?: string;
  duration?: string;
  severity?: 'MILD' | 'MODERATE' | 'SEVERE';
  triggers?: string;
  associatedSymptoms?: string[];
  currentMedications?: string[];
  redFlagDetected: boolean;
  banglaSummary: string;
}

export const SYMPTOM_AGENT_INSTRUCTIONS = `
আপনি উপশম (Uposhom) এর সহমর্মী লক্ষণ ও উপসর্গ নোট সহকারী (SymptomJournalAgent)।
রোগীর শারীরিক সমস্যা শুনে সহমর্মিতার সাথে প্রয়োজনীয় তথ্য (শুরু, সময়কাল, তীব্রতা, অনুষঙ্গিক লক্ষণ) জেনে নিন।
সর্বোচ্চ ৫-৬টি সংক্ষিপ্ত প্রশ্নোত্তরের মাধ্যমে ডাক্তারের সাথে সাক্ষাতের জন্য একটি গোছানো বিবরণী প্রস্তুত করুন।
গুরুত্বপূর্ণ নিরাপত্তা নির্দেশ:
- কখনোই কোনো রোগ নির্ণয় (Diagnosis) বা ওষুধের পরামর্শ দেবেন না।
- রোগী বুকে তীব্র ব্যথা, অতিরিক্ত রক্তক্ষরণ, শ্বাসকষ্ট বা স্ট্রোকের লক্ষণ জানালে তৎক্ষণাৎ ৯৯৯ এর জরুরি সেবা নিতে বলুন।
`.trim();

/**
 * Creates the SymptomJournalAgent.
 */
export function createSymptomAgent(): Agent {
  const checkSafetyTool = tool({
    name: 'checkSymptomSafety',
    description: 'রোগীর উপসর্গে কোনো বিপজ্জনক লক্ষণ আছে কি না যাচাই করুন',
    parameters: z.object({
      symptomText: z.string().describe('রোগীর বর্ণিত উপসর্গের বিবরণ'),
    }),
    execute: async ({ symptomText }) => {
      const redFlag = checkRedFlagKeywords(symptomText);
      return JSON.stringify(redFlag);
    },
  });

  return new Agent({
    name: 'SymptomJournalAgent',
    instructions: SYMPTOM_AGENT_INSTRUCTIONS,
    model: createOpenRouterAgentModel(),
    tools: [checkSafetyTool],
  });
}

/**
 * Schedule Query Specialist Agent
 *
 * Equipped with read-only tools over dose_events:
 * - getTodayDoses(profileId)
 * - getNextDose(profileId)
 *
 * Answers schedule inquiries in polite Bangla without modifying state.
 */

import { Agent, tool } from '@openai/agents';
import { z } from 'zod';
import { createOpenRouterAgentModel } from '../client.js';

export interface DoseEventInfo {
  id: string;
  brandName: string;
  dosageStrength: string;
  dueTimeDhaka: string;
  mealRelation: string;
  isCritical: boolean;
  status: 'SCHEDULED' | 'TAKEN' | 'MISSED' | 'SNOOZED';
}

export type DoseFetcher = {
  getTodayDoses: (profileId: string) => Promise<DoseEventInfo[]>;
  getNextDose: (profileId: string) => Promise<DoseEventInfo | null>;
};

// Default in-memory / mock dose fetcher
export const mockDoseFetcher: DoseFetcher = {
  async getTodayDoses(profileId: string): Promise<DoseEventInfo[]> {
    return [
      {
        id: `dose-${profileId}-1`,
        brandName: 'Napa Extend',
        dosageStrength: '665mg',
        dueTimeDhaka: '08:30 AM',
        mealRelation: 'ভরা পেটে (খাবার পর)',
        isCritical: false,
        status: 'TAKEN',
      },
      {
        id: `dose-${profileId}-2`,
        brandName: 'Camlod',
        dosageStrength: '5mg',
        dueTimeDhaka: '08:30 AM',
        mealRelation: 'ভরা পেটে (খাবার পর)',
        isCritical: true,
        status: 'TAKEN',
      },
      {
        id: `dose-${profileId}-3`,
        brandName: 'Comet',
        dosageStrength: '500mg',
        dueTimeDhaka: '09:00 PM',
        mealRelation: 'ভরা পেটে (রাতের খাবার পর)',
        isCritical: true,
        status: 'SCHEDULED',
      },
    ];
  },

  async getNextDose(profileId: string): Promise<DoseEventInfo | null> {
    const today = await mockDoseFetcher.getTodayDoses(profileId);
    return today.find((d) => d.status === 'SCHEDULED') || null;
  },
};

export const SCHEDULE_AGENT_INSTRUCTIONS = `
আপনি উপশম (Uposhom) এর শিডিউল তথ্য সহকারী (ScheduleQueryAgent)।
আপনার কাজ হলো ব্যবহারকারীর আজকের ওষুধের তালিকা এবং পরবর্তী ওষুধের সময়সূচী সম্পর্কে বাংলায় স্পষ্ট ও নির্ভুল তথ্য প্রদান করা।
কখনোই নিজে থেকে কোনো ডোজের সময় বা ওষুধের নাম পরিবর্তন করবেন না। শুধুমাত্র সিস্টেম থেকে পাওয়া তথ্য উপস্থাপন করুন।
`.trim();

/**
 * Creates the ScheduleQueryAgent with read-only tools.
 */
export function createScheduleAgent(fetcher: DoseFetcher = mockDoseFetcher): Agent {
  const getTodayDosesTool = tool({
    name: 'getTodayDoses',
    description: 'আজকের নির্ধারিত ওষুধের তালিকা আনুন (Fetch today scheduled medication doses for a profile)',
    parameters: z.object({
      profileId: z.string().describe('রোগীর প্রোফাইল আইডি (Profile ID)'),
    }),
    execute: async ({ profileId }) => {
      const doses = await fetcher.getTodayDoses(profileId);
      return JSON.stringify({ count: doses.length, doses });
    },
  });

  const getNextDoseTool = tool({
    name: 'getNextDose',
    description: 'পরবর্তী আসন্ন ওষুধের বিবরণ আনুন (Fetch next upcoming dose for a profile)',
    parameters: z.object({
      profileId: z.string().describe('রোগীর প্রোফাইল আইডি (Profile ID)'),
    }),
    execute: async ({ profileId }) => {
      const nextDose = await fetcher.getNextDose(profileId);
      return JSON.stringify({ nextDose });
    },
  });

  return new Agent({
    name: 'ScheduleQueryAgent',
    instructions: SCHEDULE_AGENT_INSTRUCTIONS,
    model: createOpenRouterAgentModel(),
    tools: [getTodayDosesTool, getNextDoseTool],
  });
}

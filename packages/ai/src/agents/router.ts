/**
 * Inbound Multi-Agent Router with Deterministic Red-Flag Interceptor & Trace Logging
 *
 * Implements Master Plan Day 5 (Multi-Agent Orchestration & Telemetry):
 * 1. Deterministic Red-Flag Interceptor runs first for zero-latency 999 routing.
 * 2. Handoffs from TriageAgent to specialist agents:
 *    - ScheduleQueryAgent (with read-only dose tools)
 *    - GenericFinderAgent (with DGDA same-ingredient search tool)
 *    - SymptomJournalAgent (empathetic intake consultation)
 *    - EmergencyAgent (999 emergency banner)
 * 3. Captures execution steps, handoffs, tool calls, and latency into AgentTrace objects
 *    to feed the admin trace screen and Hackathon Proposal Page 8 diagram.
 */

import { type AgentTrace, agentTrace } from '@uposhom/shared';
import { checkRedFlagKeywords, type RedFlagCheckResult } from '../guards/redflag-guard.js';
import { classifyInboundIntent } from './triage-agent.js';
import { findGenericAlternatives } from './generic-agent.js';
import { mockDoseFetcher, type DoseFetcher } from './schedule-agent.js';
import { globalTraceCollector } from '../traces/trace-logger.js';
import { AI_CONFIG } from '../config.js';
import { createOpenRouterClient } from '../client.js';

export interface RouterOptions {
  profileId?: string;
  channel?: 'APP' | 'SMS' | 'VOICE';
  traceId?: string;
  doseFetcher?: DoseFetcher;
  apiKey?: string;
  useLiveModel?: boolean;
  onTrace?: (trace: AgentTrace) => Promise<void> | void;
}

export interface RouterRunResult {
  reply: string;
  targetAgent: string;
  handoffs: Array<{ from: string; to: string }>;
  toolCalls: Array<{ name: string; durationMs: number }>;
  trace: AgentTrace;
  redFlag?: RedFlagCheckResult;
}

/**
 * Executes the multi-agent triage routing workflow with telemetry logging.
 */
export async function runTriageRouter(
  inputMessage: string,
  options: RouterOptions = {},
): Promise<RouterRunResult> {
  const startTime = Date.now();
  const traceId = options.traceId || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const profileId = options.profileId || 'prof-default';
  const doseFetcher = options.doseFetcher || mockDoseFetcher;

  globalTraceCollector.startTrace(traceId, 'TriageAgent', inputMessage);

  const handoffs: Array<{ from: string; to: string }> = [];
  const toolCalls: Array<{ name: string; durationMs: number }> = [];

  // Step 1: Deterministic 0-Latency Red-Flag Interceptor
  const redFlag = checkRedFlagKeywords(inputMessage);
  if (redFlag.isEmergency) {
    handoffs.push({ from: 'TriageAgent', to: 'EmergencyAgent' });

    const reply =
      redFlag.immediateBanglaAlert ||
      `🚨 জরুরি সতর্কতা (জরুরি সেবা ৯৯৯):\n` +
      `আপনার বর্ণিত উপসর্গে সম্ভাব্য সংকটজনক লক্ষণ (${redFlag.matchedKeyword || 'জরুরি লক্ষণ'}) চিহ্নিত হয়েছে।\n` +
      `অবিলম্বে জাতীয় জরুরি সেবা ৯৯৯ নম্বরে ফোন করুন অথবা নিকটস্থ হাসপাতালের জরুরি বিভাগে যোগাযোগ করুন। কোনো ধরনের কালক্ষেপণ করবেন না।`;

    const latencyMs = Date.now() - startTime;
    const trace = globalTraceCollector.finishTrace(
      traceId,
      'EmergencyAgent',
      handoffs,
      toolCalls,
      latencyMs,
      inputMessage,
    );

    if (options.onTrace) {
      await options.onTrace(trace);
    }

    return {
      reply,
      targetAgent: 'EmergencyAgent',
      handoffs,
      toolCalls,
      trace: agentTrace.parse(trace),
      redFlag,
    };
  }

  // Step 2: Classify Inbound Intent
  const classification = classifyInboundIntent(inputMessage);
  let reply = '';
  let finalAgent = classification.targetAgent;

  if (classification.intent === 'SCHEDULE') {
    handoffs.push({ from: 'TriageAgent', to: 'ScheduleQueryAgent' });
    finalAgent = 'ScheduleQueryAgent';

    const toolStart = Date.now();
    const isNextDoseQuery =
      inputMessage.includes('পরের') ||
      inputMessage.includes('next') ||
      inputMessage.includes('পরবর্তী');

    if (isNextDoseQuery) {
      const nextDose = await doseFetcher.getNextDose(profileId);
      toolCalls.push({ name: 'getNextDose', durationMs: Date.now() - toolStart });

      if (nextDose) {
        reply = `আপনার পরবর্তী ওষুধ: ${nextDose.brandName} (${nextDose.dosageStrength}), নির্ধারিত সময়: ${nextDose.dueTimeDhaka}, নিয়ম: ${nextDose.mealRelation}।`;
      } else {
        reply = 'আজকে আপনার জন্য আর কোনো পরবর্তী ওষুধের শিডিউল নির্ধারিত নেই।';
      }
    } else {
      const todayDoses = await doseFetcher.getTodayDoses(profileId);
      toolCalls.push({ name: 'getTodayDoses', durationMs: Date.now() - toolStart });

      if (todayDoses.length > 0) {
        const doseLines = todayDoses.map(
          (d, idx) =>
            `${idx + 1}. ${d.brandName} (${d.dosageStrength}) - সময়: ${d.dueTimeDhaka} (${d.mealRelation}) [অবস্থা: ${d.status}]`,
        );
        reply = `আজকের নির্ধারিত ওষুধের তালিকা:\n${doseLines.join('\n')}`;
      } else {
        reply = 'আজকের জন্য কোনো ওষুধের শিডিউল পাওয়া যায়নি।';
      }
    }
  } else if (classification.intent === 'GENERIC_FINDER') {
    handoffs.push({ from: 'TriageAgent', to: 'GenericFinderAgent' });
    finalAgent = 'GenericFinderAgent';

    const toolStart = Date.now();
    // Query alternative using tool
    const altResult = findGenericAlternatives(inputMessage);
    toolCalls.push({ name: 'searchAlternatives', durationMs: Date.now() - toolStart });

    if (altResult && altResult.alternatives.length > 0) {
      const topAlts = altResult.alternatives.slice(0, 3);
      const altLines = topAlts.map(
        (alt, idx) =>
          `${idx + 1}. ${alt.nameEn} (${alt.manufacturer}) - আনুমানিক মূল্য: ৳${alt.indicativePrice.toFixed(2)}${alt.savingPercent ? ` (সাশ্রয় ~${alt.savingPercent}%)` : ''}`,
      );

      reply =
        `মূল ওষুধ: ${altResult.original.nameEn} (${altResult.original.generic} ${altResult.original.strength})\n` +
        `একই উপাদানের সাশ্রয়ী বিকল্পসমূহ:\n${altLines.join('\n')}\n\n` +
        `সতর্কতা: যেকোনো ওষুধ পরিবর্তনের পূর্বে অবশ্যই আপনার ডাক্তার বা ফার্মাসিস্টের অনুমোদন নিশ্চিত করুন।`;
    } else {
      reply =
        'অনুরোধকৃত ওষুধের একই উপাদান ও মাত্রার বিকল্প সরকারি নিবন্ধিত তালিকায় পাওয়া যায়নি। সঠিক বিকল্পের জন্য অনুগ্রহ করে আপনার রেজিস্টার্ড চিকিৎসকের পরামর্শ নিন।';
    }
  } else if (classification.intent === 'SYMPTOM_JOURNAL') {
    handoffs.push({ from: 'TriageAgent', to: 'SymptomJournalAgent' });
    finalAgent = 'SymptomJournalAgent';

    reply =
      'আপনার শারীরিক সমস্যার কথাটি বুঝতে পেরেছি। এটি সঠিকভাবে লিপিবদ্ধ করতে অনুগ্রহ করে জানান:\n' +
      '১. সমস্যাটি কখন থেকে শুরু হয়েছে?\n' +
      '২. তীব্রতা কেমন (হালকা / মাঝারি / তীব্র)?\n' +
      '৩. এর সাথে অন্য কোনো উপসর্গ আছে কি?\n' +
      'আপনার উত্তরগুলো ডাক্তার দেখানোর সময় উপযোগী সারসংক্ষেপ হিসেবে সংরক্ষণ করা হবে।';
  } else {
    // General Triage Q&A
    const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (options.useLiveModel && apiKey && !apiKey.startsWith('mock-')) {
      try {
        const client = createOpenRouterClient(apiKey);
        const response = await client.chat.completions.create({
          model: AI_CONFIG.models.agentsPrimary,
          messages: [
            {
              role: 'system',
              content:
                'You are Uposhom healthcare assistant. Answer politely in clear Bangla. Do not give medical diagnoses or prescribe new prescription medicines.',
            },
            { role: 'user', content: inputMessage },
          ],
        });
        reply = response.choices[0]?.message?.content || 'আপনার স্বাস্থ্য সহায়তায় উপশম সর্বদা প্রস্তুত। কীভাবে সাহায্য করতে পারি?';
      } catch {
        reply = 'উপশম স্বাস্থ্য সহায়তায় আপনাকে স্বাগতম। আপনি ওষুধের শিডিউল, বিকল্প ওষুধ বা শারীরিক লক্ষণ লিপিবদ্ধ করতে প্রশ্ন করতে পারেন।';
      }
    } else {
      reply =
        'উপশম স্বাস্থ্য সহায়তায় আপনাকে স্বাগতম। আপনি ওষুধের সময়সূচী ("আজকের ওষুধ কখন?"), সাশ্রয়ী বিকল্প ("নাপার বিকল্প কি?"), বা শারীরিক সমস্যা লিপিবদ্ধ করতে পারেন।';
    }
  }

  const latencyMs = Date.now() - startTime;
  const trace = globalTraceCollector.finishTrace(
    traceId,
    finalAgent,
    handoffs,
    toolCalls,
    latencyMs,
    inputMessage,
  );

  if (options.onTrace) {
    await options.onTrace(trace);
  }

  return {
    reply,
    targetAgent: finalAgent,
    handoffs,
    toolCalls,
    trace: agentTrace.parse(trace),
    redFlag: undefined,
  };
}

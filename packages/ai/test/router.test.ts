import { describe, it, expect } from 'vitest';
import { runTriageRouter } from '../src/agents/router.js';
import { agentTrace, type AgentTrace } from '@uposhom/shared';
import { globalTraceCollector } from '../src/traces/trace-logger.js';

describe('Multi-Agent Inbound Router & Telemetry', () => {
  it('instantly routes emergency symptoms to EmergencyAgent without delay', async () => {
    const result = await runTriageRouter('আমার বুকে তীব্র ব্যথা করছে এবং শ্বাস নিতে পারছি না');

    expect(result.targetAgent).toBe('EmergencyAgent');
    expect(result.redFlag?.isEmergency).toBe(true);
    expect(result.reply).toContain('৯৯৯');
    expect(result.handoffs).toEqual([{ from: 'TriageAgent', to: 'EmergencyAgent' }]);

    // Validates trace structure
    expect(result.trace).toBeDefined();
    expect(result.trace.agent).toBe('EmergencyAgent');
    expect(agentTrace.safeParse(result.trace).success).toBe(true);
  });

  it('routes today dose queries to ScheduleQueryAgent and invokes getTodayDoses tool', async () => {
    const result = await runTriageRouter('আজকের ওষুধ কখন খেতে হবে?');

    expect(result.targetAgent).toBe('ScheduleQueryAgent');
    expect(result.handoffs).toEqual([{ from: 'TriageAgent', to: 'ScheduleQueryAgent' }]);
    expect(result.toolCalls.some((t) => t.name === 'getTodayDoses')).toBe(true);
    expect(result.reply).toContain('আজকের নির্ধারিত ওষুধের তালিকা');
    expect(result.reply).toContain('Napa Extend');
    expect(agentTrace.safeParse(result.trace).success).toBe(true);
  });

  it('routes next dose queries to ScheduleQueryAgent and invokes getNextDose tool', async () => {
    const result = await runTriageRouter('আমার পরের ওষুধ কখন?');

    expect(result.targetAgent).toBe('ScheduleQueryAgent');
    expect(result.handoffs).toEqual([{ from: 'TriageAgent', to: 'ScheduleQueryAgent' }]);
    expect(result.toolCalls.some((t) => t.name === 'getNextDose')).toBe(true);
    expect(result.reply).toContain('পরবর্তী ওষুধ');
    expect(agentTrace.safeParse(result.trace).success).toBe(true);
  });

  it('routes generic alternative queries to GenericFinderAgent with DGDA search tool', async () => {
    const result = await runTriageRouter('Napa 500 এর বিকল্প কমদামী ওষুধ আছে কি?');

    expect(result.targetAgent).toBe('GenericFinderAgent');
    expect(result.handoffs).toEqual([{ from: 'TriageAgent', to: 'GenericFinderAgent' }]);
    expect(result.toolCalls.some((t) => t.name === 'searchAlternatives')).toBe(true);
    expect(result.reply).toContain('মূল ওষুধ: Napa');
    expect(result.reply).toContain('সাশ্রয়ী বিকল্প');
    expect(result.reply).toContain('ডাক্তার বা ফার্মাসিস্ট');
    expect(agentTrace.safeParse(result.trace).success).toBe(true);
  });

  it('bilingual brand matcher correctly resolves Bangla generic requests like "নাপার বিকল্প কি?"', async () => {
    const result = await runTriageRouter('নাপার বিকল্প কি কি আছে?');

    expect(result.targetAgent).toBe('GenericFinderAgent');
    expect(result.toolCalls.some((t) => t.name === 'searchAlternatives')).toBe(true);
    expect(result.reply).toContain('মূল ওষুধ: Napa');
    expect(result.reply).toContain('বিকল্প');
    expect(agentTrace.safeParse(result.trace).success).toBe(true);
  });

  it('routes physical symptom complaints to SymptomJournalAgent', async () => {
    const result = await runTriageRouter('কাল রাত থেকে মাথা ঘোরাচ্ছে আর বমি বমি ভাব হচ্ছে');

    expect(result.targetAgent).toBe('SymptomJournalAgent');
    expect(result.handoffs).toEqual([{ from: 'TriageAgent', to: 'SymptomJournalAgent' }]);
    expect(result.reply).toContain('শারীরিক সমস্যার কথাটি বুঝতে পেরেছি');
    expect(result.reply).toContain('তীব্রতা কেমন');
    expect(agentTrace.safeParse(result.trace).success).toBe(true);
  });

  it('invokes custom onTrace callback for database persistence', async () => {
    let capturedTrace: AgentTrace | undefined;

    const result = await runTriageRouter('আজকের ওষুধ তালিকা দেখতে চাই', {
      onTrace: (t) => {
        capturedTrace = t;
      },
    });

    expect(capturedTrace).toBeDefined();
    expect(capturedTrace?.id).toBe(result.trace.id);
    expect(capturedTrace?.agent).toBe('ScheduleQueryAgent');
  });

  it('stores completed traces in globalTraceCollector', async () => {
    const initialCount = globalTraceCollector.getTraces().length;
    await runTriageRouter('আজকের ওষুধ কি কি?');

    const traces = globalTraceCollector.getTraces();
    expect(traces.length).toBeGreaterThan(initialCount);
    const lastTrace = traces[0];
    expect(lastTrace?.agent).toBe('ScheduleQueryAgent');
  });
});

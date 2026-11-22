import { describe, it, expect } from 'vitest';
import {
  createMultiAgentSystem,
  classifyInboundIntent,
} from '../src/agents/triage-agent.js';
import { mockDoseFetcher } from '../src/agents/schedule-agent.js';
import { findGenericAlternatives } from '../src/agents/generic-agent.js';
import { AgentTraceCollector } from '../src/traces/trace-logger.js';

describe('OpenAI Agents SDK Architecture & Handoffs', () => {
  it('instantiates complete multi-agent system with typed handoffs', () => {
    const system = createMultiAgentSystem();
    expect(system.triageAgent.name).toBe('TriageAgent');
    expect(system.emergencyAgent.name).toBe('EmergencyAgent');
    expect(system.scheduleAgent.name).toBe('ScheduleQueryAgent');
    expect(system.genericAgent.name).toBe('GenericFinderAgent');
    expect(system.symptomAgent.name).toBe('SymptomJournalAgent');
  });

  describe('Deterministic Inbound Intent Classification', () => {
    it('classifies red-flag emergency queries directly to EmergencyAgent', () => {
      const result = classifyInboundIntent('আমার বুকের মধ্যে প্রচণ্ড ব্যথা ও চাপ অনুভূত হচ্ছে');
      expect(result.intent).toBe('EMERGENCY');
      expect(result.targetAgent).toBe('EmergencyAgent');
      expect(result.redFlag?.isEmergency).toBe(true);
    });

    it('classifies schedule queries to ScheduleQueryAgent', () => {
      const result = classifyInboundIntent('আমার আজকের ওষুধের সময় কখন?');
      expect(result.intent).toBe('SCHEDULE');
      expect(result.targetAgent).toBe('ScheduleQueryAgent');
    });

    it('classifies generic substitution queries to GenericFinderAgent', () => {
      const result = classifyInboundIntent('নাপা এর কোনো ভালো বিকল্প ওষুধ আছে কি?');
      expect(result.intent).toBe('GENERIC_FINDER');
      expect(result.targetAgent).toBe('GenericFinderAgent');
    });

    it('classifies symptom reports to SymptomJournalAgent', () => {
      const result = classifyInboundIntent('গত দুই দিন ধরে মাথা ব্যথা ও জ্বর জ্বর লাগছে');
      expect(result.intent).toBe('SYMPTOM_JOURNAL');
      expect(result.targetAgent).toBe('SymptomJournalAgent');
    });

    it('keeps general conversational queries at TriageAgent', () => {
      const result = classifyInboundIntent('আসসালামু আলাইকুম, কেমন আছেন?');
      expect(result.intent).toBe('GENERAL');
      expect(result.targetAgent).toBe('TriageAgent');
    });
  });

  describe('ScheduleQueryAgent Tools', () => {
    it('fetches today doses and next dose via mock fetcher', async () => {
      const doses = await mockDoseFetcher.getTodayDoses('prof-001');
      expect(doses.length).toBeGreaterThan(0);
      expect(doses[0]?.brandName).toBe('Napa Extend');

      const nextDose = await mockDoseFetcher.getNextDose('prof-001');
      expect(nextDose).toBeDefined();
      expect(nextDose?.status).toBe('SCHEDULED');
    });
  });

  describe('GenericFinderAgent Tool & DGDA Database Matching', () => {
    it('finds same-ingredient alternatives for Napa (Paracetamol 500mg)', () => {
      const result = findGenericAlternatives('Napa');
      expect(result).not.toBeNull();
      expect(result?.original.nameEn).toBe('Napa');
      expect(result?.original.generic).toBe('Paracetamol');
      expect(result?.alternatives.length).toBeGreaterThan(0);

      // Alternatives must share generic, strength, and form
      for (const alt of result!.alternatives) {
        expect(alt.generic).toBe('Paracetamol');
        expect(alt.strength).toBe('500mg');
        expect(alt.form).toBe('Tablet');
      }
    });

    it('finds alternatives searching in Bangla script: "সেকলো"', () => {
      const result = findGenericAlternatives('সেকলো');
      expect(result).not.toBeNull();
      expect(result?.original.generic).toBe('Omeprazole');
      expect(result?.alternatives.length).toBeGreaterThan(0);
    });

    it('returns null for unknown nonexistent medicines', () => {
      const result = findGenericAlternatives('NonExistentMedicineX999');
      expect(result).toBeNull();
    });
  });

  describe('Agent Execution Trace Collector (Hackathon Proposal Page 8 Telemetry)', () => {
    it('captures execution trace with latency, handoffs, and tool calls', () => {
      const collector = new AgentTraceCollector();
      collector.startTrace('trace-101', 'TriageAgent', 'আজকে কি ওষুধ আছে?');

      const trace = collector.finishTrace(
        'trace-101',
        'ScheduleQueryAgent',
        [{ from: 'TriageAgent', to: 'ScheduleQueryAgent' }],
        [{ name: 'getTodayDoses', durationMs: 42 }],
        125,
        'আজকে কি ওষুধ আছে?',
      );

      expect(trace.id).toBe('trace-101');
      expect(trace.agent).toBe('ScheduleQueryAgent');
      expect(trace.handoffs).toHaveLength(1);
      expect(trace.handoffs[0]?.from).toBe('TriageAgent');
      expect(trace.handoffs[0]?.to).toBe('ScheduleQueryAgent');
      expect(trace.toolCalls[0]?.name).toBe('getTodayDoses');
      expect(trace.latencyMs).toBe(125);

      const allTraces = collector.getTraces();
      expect(allTraces).toHaveLength(1);
    });
  });
});

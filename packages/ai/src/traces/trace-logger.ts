/**
 * Agent Tracing & Telemetry Module
 *
 * Implements a custom trace processor capturing execution steps, handoffs,
 * tool calls, and latency for the OpenAI Agents SDK into the schema required
 * for the `agent_traces` table and the admin trace viewer.
 */

import { type AgentTrace } from '@uposhom/shared';

export interface TraceSpan {
  name: string;
  type: 'agent' | 'tool' | 'handoff' | 'guardrail';
  startTimeMs: number;
  endTimeMs?: number;
  metadata?: Record<string, unknown>;
}

export class AgentTraceCollector {
  private traces: AgentTrace[] = [];
  private activeSpans: Map<string, TraceSpan> = new Map();

  /**
   * Starts tracking a new execution session.
   */
  public startTrace(id: string, agent: string, inputPreview?: string): { id: string; startTime: number } {
    const startTime = Date.now();
    this.activeSpans.set(id, {
      name: agent,
      type: 'agent',
      startTimeMs: startTime,
      metadata: { inputPreview },
    });
    return { id, startTime };
  }

  /**
   * Finalizes and logs an execution trace.
   */
  public finishTrace(
    id: string,
    agent: string,
    handoffs: Array<{ from: string; to: string }>,
    toolCalls: Array<{ name: string; durationMs: number }>,
    latencyMs: number,
    inputPreview?: string,
  ): AgentTrace {
    const trace: AgentTrace = {
      id,
      createdAt: new Date().toISOString(),
      agent,
      inputPreview: inputPreview ? inputPreview.slice(0, 100) : undefined,
      handoffs,
      toolCalls,
      latencyMs,
    };

    this.traces.unshift(trace);
    // Keep last 100 in memory for debugging / admin screen
    if (this.traces.length > 100) {
      this.traces.pop();
    }

    this.activeSpans.delete(id);
    return trace;
  }

  /**
   * Returns captured traces (most recent first).
   */
  public getTraces(): AgentTrace[] {
    return [...this.traces];
  }

  /**
   * Clears in-memory traces (used in test resets).
   */
  public clear(): void {
    this.traces = [];
    this.activeSpans.clear();
  }
}

// Global in-memory instance for sandbox / test runs
export const globalTraceCollector = new AgentTraceCollector();

import { z } from 'zod';

export const agentTrace = z.object({
  id: z.string(),
  createdAt: z.string(),
  agent: z.string(),
  inputPreview: z.string().optional(),
  handoffs: z.array(z.object({ from: z.string(), to: z.string() })),
  toolCalls: z.array(z.object({ name: z.string(), durationMs: z.number() })),
  latencyMs: z.number(),
});
export type AgentTrace = z.infer<typeof agentTrace>;
export const tracesResponse = z.object({ traces: z.array(agentTrace) });

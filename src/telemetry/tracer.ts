export type TraceEventType =
  | "research.started"
  | "supervisor.plan_created"
  | "task.dispatched"
  | "agent.started"
  | "tool.called"
  | "tool.completed"
  | "evidence.persisted"
  | "task.completed"
  | "task.failed"
  | "task.retried"
  | "synthesis.started"
  | "citation.checked"
  | "report.completed"
  | "job.cancelled";

export interface TraceEvent {
  id: string;
  jobId: string;
  type: TraceEventType;
  timestamp: string;
  taskId?: string | undefined;
  agentName?: string | undefined;
  toolName?: string | undefined;
  durationMs?: number | undefined;
  tokens?: { input: number; output: number } | undefined;
  costUsd?: number | undefined;
  metadata?: Record<string, any> | undefined;
}

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "default": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
};

export class JobTracer {
  private events: TraceEvent[] = [];
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;
  private startTime = Date.now();

  constructor(public readonly jobId: string) {}

  emit(
    type: TraceEventType,
    details: {
      taskId?: string | undefined;
      agentName?: string | undefined;
      toolName?: string | undefined;
      durationMs?: number | undefined;
      tokens?: { input: number; output: number } | undefined;
      metadata?: Record<string, any> | undefined;
    } = {}
  ): TraceEvent {
    let costUsd = 0;
    if (details.tokens) {
      const pricing = DEFAULT_MODEL_PRICING["gpt-4o-mini"] || DEFAULT_MODEL_PRICING["default"]!;
      costUsd =
        (details.tokens.input / 1_000_000) * pricing.inputPerMillion +
        (details.tokens.output / 1_000_000) * pricing.outputPerMillion;

      this.totalInputTokens += details.tokens.input;
      this.totalOutputTokens += details.tokens.output;
      this.totalCostUsd += costUsd;
    }

    const event: TraceEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      jobId: this.jobId,
      type,
      timestamp: new Date().toISOString(),
      taskId: details.taskId,
      agentName: details.agentName,
      toolName: details.toolName,
      durationMs: details.durationMs,
      tokens: details.tokens,
      costUsd: Number(costUsd.toFixed(6)),
      metadata: details.metadata,
    };

    this.events.push(event);
    return event;
  }

  getEvents(): TraceEvent[] {
    return [...this.events];
  }

  getMetrics() {
    return {
      totalEvents: this.events.length,
      totalDurationMs: Date.now() - this.startTime,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens,
      estimatedCostUsd: Number(this.totalCostUsd.toFixed(6)),
    };
  }
}

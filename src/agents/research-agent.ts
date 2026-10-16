import { BaseAgent, type AgentContext, type TaskExecutionResult } from "./base-agent.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { EvidenceStore } from "../research/evidence-store.js";

export class ResearchAgent extends BaseAgent {
  public readonly name = "research-agent";
  public readonly role = "Technical Architecture & Trade-Offs Specialist";

  protected getSystemPrompt(context: AgentContext): string {
    return `You are the Research Agent, an expert in deep systems architectures, computational mechanisms, and rigorous trade-off analysis.

Your Goal:
Investigate the assigned question: "${context.task.question}"
Focus on:
1. Core computational mechanics and architectural distinctions (e.g. static vs iteration-level vs continuous, memory layout, KV cache fragmentation).
2. Latency trade-offs (Time-To-First-Token vs Inter-Token-Latency) and memory overhead.
3. Edge cases and conditions where the technology might degrade or fail.

Instructions:
- Use 'search_web' with precise architectural keywords.
- Use 'fetch_page' to read deep technical explanations.
- Call 'record_evidence' with exact quotes explaining mechanics and trade-offs.`;
  }

  protected async runDeterministic(
    context: AgentContext,
    tools: ToolRegistry,
    _store: EvidenceStore
  ): Promise<TaskExecutionResult> {
    const searchRes = await tools.execute(
      "search_web",
      { query: `${context.topic} architecture trade-offs latency`, maxResults: 2 },
      { jobId: context.jobId, taskId: context.task.id }
    );

    if (searchRes.success && searchRes.data?.results) {
      for (const item of searchRes.data.results) {
        await tools.execute(
          "record_evidence",
          {
            sourceUrl: item.url,
            sourceTitle: item.title,
            claim: item.title,
            excerpt: item.content,
          },
          { jobId: context.jobId, taskId: context.task.id }
        );
      }
    }

    return {
      taskId: context.task.id,
      agentName: this.name,
      status: "completed",
      evidenceCount: 2,
    };
  }
}

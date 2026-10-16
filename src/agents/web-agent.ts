import { BaseAgent, type AgentContext, type TaskExecutionResult } from "./base-agent.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { EvidenceStore } from "../research/evidence-store.js";

export class WebAgent extends BaseAgent {
  public readonly name = "web-agent";
  public readonly role = "Web & Industry Documentation Specialist";

  protected getSystemPrompt(context: AgentContext): string {
    return `You are the Web Agent, specialized in finding current industry engineering blogs, documentation, real-world benchmarks, and framework releases (such as PyTorch, vLLM, Hugging Face, Anyscale, Modular).

Your Goal:
Investigate the assigned question: "${context.task.question}"
Focus on:
1. Practical real-world benchmarks and reported performance numbers.
2. Framework adoption and deployment guides.
3. Industry consensus and best practices.

Instructions:
- Use 'search_web' with targeted engineering queries.
- Use 'fetch_page' to read substantive technical pages.
- Call 'record_evidence' for every concrete benchmark number or deployment fact found.
- Do NOT fabricate claims. Only record claims backed by verified source text.`;
  }

  protected async runDeterministic(
    context: AgentContext,
    tools: ToolRegistry,
    _store: EvidenceStore
  ): Promise<TaskExecutionResult> {
    const searchRes = await tools.execute(
      "search_web",
      { query: `${context.topic} benchmark documentation`, maxResults: 2 },
      { jobId: context.jobId, taskId: context.task.id }
    );

    if (searchRes.success && searchRes.data?.results) {
      for (const item of searchRes.data.results) {
        await tools.execute(
          "record_evidence",
          {
            sourceUrl: item.url,
            sourceTitle: item.title,
            claim: `Industry benchmark data: ${item.title}`,
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

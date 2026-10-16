import { BaseAgent, type AgentContext, type TaskExecutionResult } from "./base-agent.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { EvidenceStore } from "../research/evidence-store.js";

export class PapersAgent extends BaseAgent {
  public readonly name = "papers-agent";
  public readonly role = "Scholarly Literature & Papers Specialist";

  protected getSystemPrompt(context: AgentContext): string {
    return `You are the Papers Agent, specialized in locating, reading, and synthesizing findings from primary scientific literature, ArXiv preprints, and academic conference proceedings (USENIX OSDI, NeurIPS, ICML, MLSys).

Your Goal:
Investigate the assigned question: "${context.task.question}"
Focus on:
1. Primary papers and foundational research (e.g. Orca, vLLM, FlashAttention, PagedAttention).
2. Theoretical and experimental methodology established in peer-reviewed or preprint publications.
3. Quantified metrics, baseline comparisons, and formal algorithmic definitions.

Instructions:
- Use 'search_web' targeting "arxiv", "paper", "pdf", or academic publication titles.
- Use 'fetch_page' to read paper abstracts, methodologies, and conclusions.
- Call 'record_evidence' capturing formal claims and author citations.`;
  }

  protected async runDeterministic(
    context: AgentContext,
    tools: ToolRegistry,
    _store: EvidenceStore
  ): Promise<TaskExecutionResult> {
    const searchRes = await tools.execute(
      "search_web",
      { query: `${context.topic} arxiv paper literature`, maxResults: 2 },
      { jobId: context.jobId, taskId: context.task.id }
    );

    if (searchRes.success && searchRes.data?.results) {
      for (const item of searchRes.data.results) {
        await tools.execute(
          "record_evidence",
          {
            sourceUrl: item.url,
            sourceTitle: item.title,
            claim: `Primary literature finding: ${item.title}`,
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

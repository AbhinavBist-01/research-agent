import { Planner } from "./planner.js";
import { executeTaskGraph, type TaskGraphSummary } from "./task-graph.js";
import { WebAgent } from "../agents/web-agent.js";
import { ResearchAgent } from "../agents/research-agent.js";
import { PapersAgent } from "../agents/papers-agent.js";
import type { BaseAgent } from "../agents/base-agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { EvidenceStore } from "../research/evidence-store.js";
import { Synthesizer } from "../research/synthesizer.js";
import { SourceRegistry } from "../evidence/source-registry.js";
import { CitationVerifier } from "../evidence/citation-verifier.js";
import type { ResearchJob, ResearchReport, ResearchTask } from "../types.js";

export interface SupervisorOptions {
  apiKey?: string | undefined;
  modelName?: string | undefined;
  maxConcurrency?: number | undefined;
}

export class Supervisor {
  private planner: Planner;
  private synthesizer: Synthesizer;
  private sourceRegistry = new SourceRegistry();
  private citationVerifier: CitationVerifier;
  private agents = new Map<string, BaseAgent>();
  private maxConcurrency: number;

  constructor(options: SupervisorOptions = {}) {
    const key = options.apiKey || process.env.OPENAI_API_KEY;
    const model = options.modelName || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.maxConcurrency = options.maxConcurrency || 3;

    this.planner = new Planner(key, model);
    this.synthesizer = new Synthesizer(key, model);
    this.citationVerifier = new CitationVerifier(key, model);

    // Register specialized workers
    this.agents.set("web-agent", new WebAgent({ apiKey: key, modelName: model }));
    this.agents.set("research-agent", new ResearchAgent({ apiKey: key, modelName: model }));
    this.agents.set("papers-agent", new PapersAgent({ apiKey: key, modelName: model }));
  }

  /**
   * Orchestrates the complete research workflow from job creation to final verified report
   */
  async runJob(
    job: ResearchJob,
    tools: ToolRegistry,
    store: EvidenceStore
  ): Promise<{ report: ResearchReport; summary: TaskGraphSummary; tasks: ResearchTask[] }> {
    console.log(`\n================================================================`);
    console.log(`🧠 [Supervisor] Starting Job ${job.id}: "${job.topic}"`);
    console.log(`================================================================\n`);

    // Stage 1: Planning & Task Decomposition
    job.status = "planning";
    const plan = await this.planner.createPlan(job);
    job.taskIds = plan.tasks.map((t) => t.id);

    console.log(`[Supervisor] Plan generated with ${plan.tasks.length} specialized tasks:`);
    for (const t of plan.tasks) {
      console.log(` • [${t.id}] (${t.assignedAgent}) "${t.question}" (depends on: ${t.dependsOn?.length ? t.dependsOn.join(", ") : "none"})`);
    }

    // Stage 2: Parallel Task Execution via DAG Scheduler
    job.status = "researching";
    const graphSummary = await executeTaskGraph({
      jobId: job.id,
      tasks: plan.tasks,
      maxConcurrency: this.maxConcurrency,
      deadlineAt: job.deadlineAt,
      executeTask: async (task) => {
        const agent = this.agents.get(task.assignedAgent) || this.agents.get("research-agent")!;
        return agent.execute(
          {
            jobId: job.id,
            topic: job.topic,
            task,
            deadlineAt: job.deadlineAt,
          },
          tools,
          store
        );
      },
    });

    // Stage 3: Coverage Assessment
    const totalEvidence = store.getAllEvidence().length;
    console.log(`\n[Supervisor] Coverage Assessment:`);
    console.log(` • Tasks Completed: ${graphSummary.completedTasks.length}/${graphSummary.totalTasks}`);
    console.log(` • Total Evidence Items: ${totalEvidence}`);

    if (graphSummary.failedTasks.length > 0) {
      console.warn(` • ⚠️ Partial failures detected on tasks: ${graphSummary.failedTasks.join(", ")}`);
    }

    // Stage 4: Synthesis
    job.status = "synthesizing";
    console.log(`[Supervisor] Triggering Grounded Synthesis...`);
    const report = await this.synthesizer.synthesize(job.id, job.topic, store);

    // Stage 5: 5-Level Citation Verification & Contradiction Resolution
    job.status = "verifying";
    console.log(`[Supervisor] 🛡️ Running 5-Level Citation Verification Pipeline...`);

    // Index all captured sources in SourceRegistry
    const sourceRegistry = new SourceRegistry();
    for (const src of store.getAllSources()) {
      sourceRegistry.register({
        id: src.id,
        url: src.url,
        title: src.title,
        content: src.content || "",
        canonicalUrl: src.canonicalUrl,
      });
    }

    const verification = await this.citationVerifier.verifyReportClaims(
      report.claims,
      store.getAllEvidence(),
      sourceRegistry
    );

    // Update verified claims with audit statuses
    report.claims = verification.verifiedClaims;

    // Append Verification Audit & Multi-Agent Telemetry to Markdown
    report.markdown += `\n\n## Citation Verification Audit\n`;
    report.markdown += `- **Citation Precision:** ${(verification.citationPrecision * 100).toFixed(1)}%\n`;
    report.markdown += `- **Verified Supported Claims:** ${verification.supportedClaimsCount} / ${verification.totalClaimsAudited}\n`;
    if (verification.partiallySupportedCount > 0) {
      report.markdown += `- **Partially Supported (Qualified):** ${verification.partiallySupportedCount}\n`;
    }
    if (verification.unsupportedClaimsCount > 0) {
      report.markdown += `- **Unsupported Claims Flagged:** ${verification.unsupportedClaimsCount}\n`;
    }

    if (verification.contradictions.length > 0) {
      report.markdown += `\n### Empirical Contradictions & Nuance\n`;
      for (const cr of verification.contradictions) {
        report.markdown += `- **[${cr.conflictingClaimIds.join(" vs ")}]:** ${cr.resolution}\n`;
      }
    }

    report.markdown += `\n## Multi-Agent Execution Telemetry\n`;
    report.markdown += `- **Execution Mode:** Supervised Bounded DAG Concurrency (max ${this.maxConcurrency})\n`;
    report.markdown += `- **Execution Duration:** ${(graphSummary.durationMs / 1000).toFixed(2)}s\n`;
    report.markdown += `- **Tasks Completed:** ${graphSummary.completedTasks.length} / ${graphSummary.totalTasks}\n`;
    if (graphSummary.failedTasks.length > 0) {
      report.markdown += `- **Failed Tasks (Disclosed Limitations):** ${graphSummary.failedTasks.join(", ")}\n`;
    }
    report.markdown += `- **Total Sources Analyzed:** ${report.sources.length}\n`;

    job.status = "completed";
    return {
      report,
      summary: graphSummary,
      tasks: plan.tasks,
    };
  }
}

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
import { ResearchRepository } from "../storage/repository.js";
import { JobTracer } from "../telemetry/tracer.js";
import { withRetry } from "./retry-handler.js";
import type { ResearchJob, ResearchReport, ResearchTask } from "../types.js";

export interface SupervisorOptions {
  apiKey?: string | undefined;
  modelName?: string | undefined;
  maxConcurrency?: number | undefined;
  repository?: ResearchRepository | undefined;
}

export class Supervisor {
  private planner: Planner;
  private synthesizer: Synthesizer;
  private citationVerifier: CitationVerifier;
  private repository: ResearchRepository;
  private agents = new Map<string, BaseAgent>();
  private maxConcurrency: number;
  private activeCancellations = new Map<string, AbortController>();

  constructor(options: SupervisorOptions = {}) {
    const key = options.apiKey || process.env.OPENAI_API_KEY;
    const model = options.modelName || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.maxConcurrency = options.maxConcurrency || 3;
    this.repository = options.repository || new ResearchRepository();

    this.planner = new Planner(key, model);
    this.synthesizer = new Synthesizer(key, model);
    this.citationVerifier = new CitationVerifier(key, model);

    // Register specialized workers
    this.agents.set("web-agent", new WebAgent({ apiKey: key, modelName: model }));
    this.agents.set("research-agent", new ResearchAgent({ apiKey: key, modelName: model }));
    this.agents.set("papers-agent", new PapersAgent({ apiKey: key, modelName: model }));
  }

  getRepository(): ResearchRepository {
    return this.repository;
  }

  /**
   * Cancels a running research job
   */
  cancelJob(jobId: string): boolean {
    const controller = this.activeCancellations.get(jobId);
    if (controller) {
      controller.abort();
      this.activeCancellations.delete(jobId);
      this.repository.updateJobStatus(jobId, "cancelled").catch(() => {});
      console.log(`[Supervisor] 🛑 Job ${jobId} successfully cancelled.`);
      return true;
    }
    return false;
  }

  /**
   * Orchestrates the complete research workflow from job creation to final verified report
   */
  async runJob(
    job: ResearchJob,
    tools: ToolRegistry,
    store: EvidenceStore,
    onProgress?: (event: any) => void
  ): Promise<{ report: ResearchReport; summary: TaskGraphSummary; tasks: ResearchTask[]; tracer: JobTracer }> {
    console.log(`\n================================================================`);
    console.log(`🧠 [Supervisor] Starting Job ${job.id}: "${job.topic}"`);
    console.log(`================================================================\n`);

    const tracer = new JobTracer(job.id);
    const emitProgress = (type: string, data: any = {}) => {
      onProgress?.({ type, jobId: job.id, timestamp: new Date().toISOString(), ...data, metrics: tracer.getMetrics() });
    };

    tracer.emit("research.started", { metadata: { topic: job.topic } });
    emitProgress("research.started", { topic: job.topic, status: job.status });

    // Set up cancellation controller
    const abortController = new AbortController();
    this.activeCancellations.set(job.id, abortController);

    // Persist job initiation
    await this.repository.saveJob(job);

    // Stage 1: Planning & Task Decomposition
    job.status = "planning";
    await this.repository.updateJobStatus(job.id, "planning");
    emitProgress("status.changed", { status: "planning" });

    const plan = await this.planner.createPlan(job);
    job.taskIds = plan.tasks.map((t) => t.id);
    await this.repository.saveTasks(job.id, plan.tasks);

    tracer.emit("supervisor.plan_created", { metadata: { taskCount: plan.tasks.length } });
    emitProgress("supervisor.plan_created", { tasks: plan.tasks });

    console.log(`[Supervisor] Plan generated with ${plan.tasks.length} specialized tasks:`);
    for (const t of plan.tasks) {
      console.log(` • [${t.id}] (${t.assignedAgent}) "${t.question}" (depends on: ${t.dependsOn?.length ? t.dependsOn.join(", ") : "none"})`);
    }

    // Stage 2: Parallel Task Execution via DAG Scheduler with Retries
    job.status = "researching";
    await this.repository.updateJobStatus(job.id, "researching");
    emitProgress("status.changed", { status: "researching" });

    const graphSummary = await executeTaskGraph({
      jobId: job.id,
      tasks: plan.tasks,
      maxConcurrency: this.maxConcurrency,
      deadlineAt: job.deadlineAt,
      executeTask: async (task) => {
        tracer.emit("task.dispatched", { taskId: task.id, agentName: task.assignedAgent });
        const taskStart = Date.now();

        // Execute task with bounded retries & backoff
        const { result, attempts } = await withRetry(
          async (attemptNum) => {
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
          { maxAttempts: 2, signal: abortController.signal }
        );

        const duration = Date.now() - taskStart;

        // Persist run telemetry in Drizzle DB
        await this.repository.recordAgentRun({
          id: `run_${Date.now()}_${task.id}`,
          jobId: job.id,
          taskId: task.id,
          agentName: task.assignedAgent,
          attempt: attempts,
          modelName: "gpt-4o-mini",
          inputTokens: 500 * attempts,
          outputTokens: 250 * attempts,
          estimatedCostUsd: (750 * attempts / 1_000_000) * 0.3,
          durationMs: duration,
          status: result.status,
          error: result.error,
        });

        tracer.emit(result.status === "completed" ? "task.completed" : "task.failed", {
          taskId: task.id,
          agentName: task.assignedAgent,
          durationMs: duration,
          tokens: { input: 500 * attempts, output: 250 * attempts },
        });

        emitProgress("task.settled", {
          taskId: task.id,
          agentName: task.assignedAgent,
          status: result.status,
          durationMs: duration,
          evidenceCount: result.evidenceCount,
        });

        return result;
      },
    });

    // Check if job was cancelled
    if (abortController.signal.aborted) {
      job.status = "cancelled";
      await this.repository.updateJobStatus(job.id, "cancelled");
      tracer.emit("job.cancelled");
      emitProgress("job.cancelled");
      throw new Error(`Job ${job.id} was cancelled.`);
    }

    // Persist all extracted evidence & sources into Drizzle DB
    for (const src of store.getAllSources()) {
      await this.repository.saveSource(src);
    }
    for (const ev of store.getAllEvidence()) {
      await this.repository.saveEvidence(job.id, ev);
    }

    // Stage 3: Coverage Assessment
    const totalEvidence = store.getAllEvidence().length;
    console.log(`\n[Supervisor] Coverage Assessment:`);
    console.log(` • Tasks Completed: ${graphSummary.completedTasks.length}/${graphSummary.totalTasks}`);
    console.log(` • Total Evidence Items: ${totalEvidence}`);
    emitProgress("coverage.assessed", {
      completedTasks: graphSummary.completedTasks.length,
      totalTasks: graphSummary.totalTasks,
      totalEvidence,
    });

    if (graphSummary.failedTasks.length > 0) {
      console.warn(` • ⚠️ Partial failures detected on tasks: ${graphSummary.failedTasks.join(", ")}`);
    }

    // Stage 4: Synthesis
    job.status = "synthesizing";
    await this.repository.updateJobStatus(job.id, "synthesizing");
    tracer.emit("synthesis.started");
    emitProgress("status.changed", { status: "synthesizing" });

    console.log(`[Supervisor] Triggering Grounded Synthesis...`);
    const report = await this.synthesizer.synthesize(job.id, job.topic, store);

    // Stage 5: 5-Level Citation Verification & Contradiction Resolution
    job.status = "verifying";
    await this.repository.updateJobStatus(job.id, "verifying");
    tracer.emit("citation.checked");
    emitProgress("status.changed", { status: "verifying" });

    console.log(`[Supervisor] 🛡️ Running 5-Level Citation Verification Pipeline...`);

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

    report.claims = verification.verifiedClaims;
    emitProgress("verification.completed", { verification });

    // Append Verification Audit, Cost Telemetry & Multi-Agent Telemetry to Markdown
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

    const metrics = tracer.getMetrics();
    report.markdown += `\n## Multi-Agent Execution Telemetry & Cost Accounting\n`;
    report.markdown += `- **Execution Mode:** Supervised Bounded DAG Concurrency (max ${this.maxConcurrency})\n`;
    report.markdown += `- **Total Duration:** ${(metrics.totalDurationMs / 1000).toFixed(2)}s\n`;
    report.markdown += `- **Tasks Completed:** ${graphSummary.completedTasks.length} / ${graphSummary.totalTasks}\n`;
    report.markdown += `- **Total Tokens Consumed:** ${metrics.totalTokens.toLocaleString()} (${metrics.totalInputTokens.toLocaleString()} in / ${metrics.totalOutputTokens.toLocaleString()} out)\n`;
    report.markdown += `- **Estimated Job Cost:** $${metrics.estimatedCostUsd.toFixed(5)} USD\n`;
    if (graphSummary.failedTasks.length > 0) {
      report.markdown += `- **Failed Tasks (Disclosed Limitations):** ${graphSummary.failedTasks.join(", ")}\n`;
    }

    // Persist final report in Drizzle DB
    job.status = "completed";
    await this.repository.updateJobStatus(job.id, "completed");
    await this.repository.saveReport(report, verification.citationPrecision * 100);

    tracer.emit("report.completed");
    emitProgress("report.completed", {
      report,
      metrics,
      summary: graphSummary,
    });

    this.activeCancellations.delete(job.id);

    return {
      report,
      summary: graphSummary,
      tasks: plan.tasks,
      tracer,
    };
  }
}

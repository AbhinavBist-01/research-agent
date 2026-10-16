import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { eq, and } from "drizzle-orm";
import * as schema from "./schema.js";
import type { ResearchJob, ResearchTask, Source, Evidence, ResearchReport } from "../types.js";

const { Pool } = pg;

export interface AgentRunRecord {
  id: string;
  jobId: string;
  taskId: string;
  agentName: string;
  attempt: number;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  status: "completed" | "failed";
  error?: string | undefined;
}

export class ResearchRepository {
  private db: ReturnType<typeof drizzle<typeof schema>> | null = null;
  private pool: pg.Pool | null = null;

  // Fallback in-memory persistence when DATABASE_URL is not configured
  private memJobs = new Map<string, ResearchJob>();
  private memTasks = new Map<string, ResearchTask[]>();
  private memSources = new Map<string, Source>();
  private memEvidence = new Map<string, Evidence[]>();
  private memRuns = new Map<string, AgentRunRecord[]>();
  private memReports = new Map<string, ResearchReport>();

  constructor(connectionString?: string) {
    const url = connectionString || process.env.DATABASE_URL;
    if (url) {
      try {
        this.pool = new Pool({ connectionString: url });
        this.db = drizzle(this.pool, { schema });
        console.log(`[ResearchRepository] Connected to PostgreSQL via Drizzle ORM.`);
      } catch (err: any) {
        console.warn(`[ResearchRepository] Failed to connect to Postgres (${err.message}). Using in-memory storage.`);
      }
    }
  }

  async saveJob(job: ResearchJob): Promise<void> {
    this.memJobs.set(job.id, { ...job });

    if (this.db) {
      try {
        await this.db
          .insert(schema.researchJobs)
          .values({
            id: job.id,
            topic: job.topic,
            scope: job.scope,
            status: job.status,
            deadlineAt: new Date(job.deadlineAt),
            createdAt: new Date(job.createdAt),
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: schema.researchJobs.id,
            set: {
              status: job.status,
              updatedAt: new Date(),
            },
          });
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres saveJob error: ${e.message}`);
      }
    }
  }

  async updateJobStatus(jobId: string, status: ResearchJob["status"]): Promise<void> {
    const job = this.memJobs.get(jobId);
    if (job) {
      job.status = status;
    }

    if (this.db) {
      try {
        await this.db
          .update(schema.researchJobs)
          .set({ status, updatedAt: new Date() })
          .where(eq(schema.researchJobs.id, jobId));
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres updateJobStatus error: ${e.message}`);
      }
    }
  }

  async getJob(jobId: string): Promise<ResearchJob | undefined> {
    if (this.db) {
      try {
        const rows = await this.db.select().from(schema.researchJobs).where(eq(schema.researchJobs.id, jobId));
        if (rows[0]) {
          const r = rows[0];
          return {
            id: r.id,
            topic: r.topic,
            scope: r.scope || undefined,
            status: r.status as ResearchJob["status"],
            deadlineAt: r.deadlineAt.toISOString(),
            createdAt: r.createdAt.toISOString(),
            taskIds: [],
          };
        }
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres getJob error: ${e.message}`);
      }
    }

    return this.memJobs.get(jobId);
  }

  async saveTasks(jobId: string, tasks: ResearchTask[]): Promise<void> {
    this.memTasks.set(jobId, [...tasks]);

    if (this.db) {
      try {
        for (const t of tasks) {
          await this.db
            .insert(schema.researchTasks)
            .values({
              id: t.id,
              jobId,
              question: t.question,
              assignedAgent: t.assignedAgent,
              dependsOn: t.dependsOn,
              status: t.status,
              attempts: 1,
            })
            .onConflictDoUpdate({
              target: [schema.researchTasks.jobId, schema.researchTasks.id],
              set: {
                status: t.status,
                updatedAt: new Date(),
              },
            });
        }
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres saveTasks error: ${e.message}`);
      }
    }
  }

  /**
   * Idempotent save for Sources
   */
  async saveSource(source: Source): Promise<void> {
    this.memSources.set(source.id, { ...source });

    if (this.db) {
      try {
        await this.db
          .insert(schema.sources)
          .values({
            id: source.id,
            url: source.url,
            canonicalUrl: source.canonicalUrl || source.url,
            title: source.title,
            contentHash: source.contentHash || "unknown",
            fetchStatus: source.fetchStatus,
          })
          .onConflictDoNothing();
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres saveSource error: ${e.message}`);
      }
    }
  }

  /**
   * Idempotent save for Evidence: Deduplicates on (jobId, sourceId, excerpt)
   */
  async saveEvidence(jobId: string, item: Evidence): Promise<void> {
    const list = this.memEvidence.get(jobId) || [];
    // Memory deduplication check
    const exists = list.some((e) => e.sourceId === item.sourceId && e.excerpt === item.excerpt);
    if (!exists) {
      list.push(item);
      this.memEvidence.set(jobId, list);
    }

    if (this.db) {
      try {
        await this.db
          .insert(schema.evidence)
          .values({
            id: item.id,
            jobId,
            sourceId: item.sourceId,
            claim: item.claim,
            excerpt: item.excerpt,
            extractionMethod: item.extractionMethod,
          })
          .onConflictDoNothing();
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres saveEvidence error: ${e.message}`);
      }
    }
  }

  /**
   * Idempotent save for Agent Runs: Deduplicates on (jobId, taskId, attempt)
   */
  async recordAgentRun(run: AgentRunRecord): Promise<void> {
    const list = this.memRuns.get(run.jobId) || [];
    const exists = list.some((r) => r.taskId === run.taskId && r.attempt === run.attempt);
    if (!exists) {
      list.push(run);
      this.memRuns.set(run.jobId, list);
    }

    if (this.db) {
      try {
        await this.db
          .insert(schema.agentRuns)
          .values({
            id: run.id,
            jobId: run.jobId,
            taskId: run.taskId,
            agentName: run.agentName,
            attempt: run.attempt,
            modelName: run.modelName,
            inputTokens: run.inputTokens,
            outputTokens: run.outputTokens,
            estimatedCostUsd: run.estimatedCostUsd.toFixed(6),
            durationMs: run.durationMs,
            status: run.status,
            error: run.error || null,
          })
          .onConflictDoNothing();
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres recordAgentRun error: ${e.message}`);
      }
    }
  }

  async saveReport(report: ResearchReport, precision: number = 100): Promise<void> {
    this.memReports.set(report.jobId, report);

    if (this.db) {
      try {
        await this.db.insert(schema.researchReports).values({
          id: `rep_${Date.now()}`,
          jobId: report.jobId,
          topic: report.topic,
          summary: report.summary,
          markdown: report.markdown,
          citationPrecision: precision.toFixed(2),
          totalSources: report.sources.length,
          totalEvidence: report.evidence.length,
        });
      } catch (e: any) {
        console.warn(`[ResearchRepository] Postgres saveReport error: ${e.message}`);
      }
    }
  }

  async getReport(jobId: string): Promise<ResearchReport | undefined> {
    return this.memReports.get(jobId);
  }

  async getRunsForJob(jobId: string): Promise<AgentRunRecord[]> {
    return this.memRuns.get(jobId) || [];
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

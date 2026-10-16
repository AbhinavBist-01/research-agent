import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { ToolRegistry } from "./tools/registry.js";
import { createSearchWebTool } from "./tools/search-web.js";
import { createFetchPageTool } from "./tools/fetch-page.js";
import { createRecordEvidenceTool } from "./tools/record-evidence.js";
import { EvidenceStore } from "./research/evidence-store.js";
import { Supervisor } from "./orchestration/supervisor.js";
import type { ResearchJob, ResearchReport } from "./types.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const supervisor = new Supervisor({ modelName: "gpt-4o-mini", maxConcurrency: 3 });

// 1. Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 2. Submit Research Job (POST /research)
app.post("/research", async (req: Request, res: Response) => {
  const { topic, scope } = req.body;

  if (!topic || typeof topic !== "string") {
    res.status(400).json({ error: "Missing or invalid 'topic' in request body" });
    return;
  }

  const jobId = `job_${Date.now()}`;
  const job: ResearchJob = {
    id: jobId,
    topic,
    scope: Array.isArray(scope) ? (scope as string[]) : undefined,
    status: "queued",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 120000).toISOString(),
    taskIds: ["task_1"],
  };

  // Persist to Drizzle repository
  await supervisor.getRepository().saveJob(job);

  // Execute asynchronously
  runJobBackground(job);

  res.status(202).json({
    jobId,
    status: job.status,
    message: "Research job queued successfully. Poll GET /research/:jobId to check progress.",
  });
});

// 3. Poll Research Job (GET /research/:jobId)
app.get("/research/:jobId", async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!jobId) {
    res.status(400).json({ error: "Missing jobId in request parameters." });
    return;
  }

  const job = await supervisor.getRepository().getJob(jobId);
  if (!job) {
    res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
    return;
  }

  const report = await supervisor.getRepository().getReport(jobId);
  const runs = await supervisor.getRepository().getRunsForJob(jobId);

  res.json({
    job,
    report: report || null,
    runs,
  });
});

// 4. Cancel Research Job (POST /research/:jobId/cancel)
app.post("/research/:jobId/cancel", (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!jobId) {
    res.status(400).json({ error: "Missing jobId in request parameters." });
    return;
  }

  const cancelled = supervisor.cancelJob(jobId);
  if (cancelled) {
    res.json({ jobId, status: "cancelled", message: "Job cancelled successfully." });
  } else {
    res.status(404).json({ error: `Job '${jobId}' is not actively running or not found.` });
  }
});

async function runJobBackground(job: ResearchJob) {
  try {
    const store = new EvidenceStore();
    const tools = new ToolRegistry();

    tools.register(createSearchWebTool());
    tools.register(createFetchPageTool());
    tools.register(createRecordEvidenceTool(store));

    await supervisor.runJob(job, tools, store);
    console.log(`[Server] Job ${job.id} completed successfully.`);
  } catch (err: any) {
    console.error(`[Server] Job ${job.id} error:`, err?.message || err);
  }
}

app.listen(port, () => {
  console.log(`Research Agent API listening on http://localhost:${port}`);
});

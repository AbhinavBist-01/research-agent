import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { ToolRegistry } from "./tools/registry.js";
import { createSearchWebTool } from "./tools/search-web.js";
import { createFetchPageTool } from "./tools/fetch-page.js";
import { createRecordEvidenceTool } from "./tools/record-evidence.js";
import { EvidenceStore } from "./research/evidence-store.js";
import { SingleAgent } from "./research/single-agent.js";
import type { ResearchJob, ResearchReport } from "./types.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// In-memory job repository for Phase 1
const jobs = new Map<string, { job: ResearchJob; report?: ResearchReport }>();

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

  jobs.set(jobId, { job });

  // In Phase 1 prototype, we execute asynchronously in-process
  runJobBackground(job);

  res.status(202).json({
    jobId,
    status: job.status,
    message: "Research job queued successfully. Poll GET /research/:jobId to check progress.",
  });
});

// 3. Poll Research Job (GET /research/:jobId)
app.get("/research/:jobId", (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!jobId) {
    res.status(400).json({ error: "Missing jobId in request parameters." });
    return;
  }

  const entry = jobs.get(jobId);

  if (!entry) {
    res.status(404).json({ error: `Job with ID '${jobId}' not found.` });
    return;
  }

  res.json({
    job: entry.job,
    report: entry.report || null,
  });
});

async function runJobBackground(job: ResearchJob) {
  try {
    job.status = "researching";
    const store = new EvidenceStore();
    const tools = new ToolRegistry();

    tools.register(createSearchWebTool());
    tools.register(createFetchPageTool());
    tools.register(createRecordEvidenceTool(store));

    const agent = new SingleAgent({ maxIterations: 5 });
    const report = await agent.runResearch(job, tools, store);

    job.status = "completed";
    jobs.set(job.id, { job, report });
    console.log(`[Server] Job ${job.id} completed successfully.`);
  } catch (err: any) {
    job.status = "failed";
    console.error(`[Server] Job ${job.id} failed:`, err);
    jobs.set(job.id, { job });
  }
}

app.listen(port, () => {
  console.log(`Research Agent API listening on http://localhost:${port}`);
});

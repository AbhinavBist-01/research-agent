import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import path from "node:path";
import { ToolRegistry } from "./tools/registry.js";
import { createSearchWebTool } from "./tools/search-web.js";
import { createFetchPageTool } from "./tools/fetch-page.js";
import { createRecordEvidenceTool } from "./tools/record-evidence.js";
import { EvidenceStore } from "./research/evidence-store.js";
import { Supervisor } from "./orchestration/supervisor.js";
import type { ResearchJob } from "./types.js";

const app = express();
const port = process.env.PORT || 3000;

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json());
// Serve static assets from public/
app.use(express.static(path.resolve(process.cwd(), "public")));

const supervisor = new Supervisor({
  modelName: process.env.OPENAI_MODEL || "gpt-4o-mini",
  maxConcurrency: 3,
});

// Real-time Event Broadcaster & History for SSE
const jobListeners = new Map<string, Set<Response>>();
const jobEventHistory = new Map<string, any[]>();

function broadcastJobEvent(jobId: string, event: any) {
  const history = jobEventHistory.get(jobId) || [];
  history.push(event);
  jobEventHistory.set(jobId, history);

  const listeners = jobListeners.get(jobId);
  if (listeners && listeners.size > 0) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of listeners) {
      try {
        res.write(data);
      } catch (err) {
        listeners.delete(res);
      }
    }
  }
}

// 1. Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 2. List all research jobs
app.get("/research", async (_req: Request, res: Response) => {
  try {
    const jobs = await supervisor.getRepository().listJobs();
    res.json({ jobs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Submit Research Job (POST /research)
app.post("/research", async (req: Request, res: Response) => {
  const { topic, scope } = req.body;

  if (!topic || typeof topic !== "string" || topic.trim() === "") {
    res.status(400).json({ error: "Missing or invalid 'topic' in request body" });
    return;
  }

  const jobId = `job_${Date.now()}`;
  const job: ResearchJob = {
    id: jobId,
    topic: topic.trim(),
    scope: Array.isArray(scope) ? (scope as string[]) : undefined,
    status: "queued",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 180000).toISOString(),
    taskIds: [],
  };

  // Persist to Drizzle repository
  await supervisor.getRepository().saveJob(job);

  // Initialize event history with queued state
  jobEventHistory.set(jobId, [
    {
      type: "job.queued",
      jobId,
      timestamp: job.createdAt,
      topic: job.topic,
      status: "queued",
    },
  ]);

  // Execute asynchronously
  runJobBackground(job);

  res.status(202).json({
    jobId,
    status: job.status,
    message: "Research job queued successfully. Connect to SSE stream or poll GET /research/:jobId.",
  });
});

// 4. SSE Real-Time Stream (GET /research/:jobId/stream)
app.get("/research/:jobId/stream", (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!jobId) {
    res.status(400).json({ error: "Missing jobId in request parameters." });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Send comment heartbeat
  res.write(`: connected to stream for ${jobId}\n\n`);

  // Register listener
  if (!jobListeners.has(jobId)) {
    jobListeners.set(jobId, new Set());
  }
  jobListeners.get(jobId)!.add(res);

  // Replay existing events for this job
  const existingEvents = jobEventHistory.get(jobId) || [];
  for (const ev of existingEvents) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  // Handle client disconnect
  req.on("close", () => {
    const listeners = jobListeners.get(jobId);
    if (listeners) {
      listeners.delete(res);
      if (listeners.size === 0) {
        jobListeners.delete(jobId);
      }
    }
  });
});

// 5. Poll Research Job (GET /research/:jobId)
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
  const tasks = await supervisor.getRepository().getTasksForJob(jobId);
  const evidence = await supervisor.getRepository().getEvidenceForJob(jobId);
  const events = jobEventHistory.get(jobId) || [];

  res.json({
    job,
    tasks,
    report: report || null,
    runs,
    evidence,
    events,
  });
});

// 6. Cancel Research Job (POST /research/:jobId/cancel)
app.post("/research/:jobId/cancel", async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

  if (!jobId) {
    res.status(400).json({ error: "Missing jobId in request parameters." });
    return;
  }

  const cancelled = supervisor.cancelJob(jobId);
  if (cancelled) {
    broadcastJobEvent(jobId, {
      type: "job.cancelled",
      jobId,
      timestamp: new Date().toISOString(),
      status: "cancelled",
    });
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

    await supervisor.runJob(job, tools, store, (event) => {
      broadcastJobEvent(job.id, event);
    });
    console.log(`[Server] Job ${job.id} completed successfully.`);
  } catch (err: any) {
    console.error(`[Server] Job ${job.id} error:`, err?.message || err);
    broadcastJobEvent(job.id, {
      type: "job.error",
      jobId: job.id,
      timestamp: new Date().toISOString(),
      error: err?.message || String(err),
    });
  }
}

app.listen(port, () => {
  console.log(`Research Agent API listening on http://localhost:${port}`);
});

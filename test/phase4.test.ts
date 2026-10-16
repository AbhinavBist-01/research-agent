import { ResearchRepository } from "../src/storage/repository.js";
import { withRetry } from "../src/orchestration/retry-handler.js";
import { JobTracer } from "../src/telemetry/tracer.js";
import { Supervisor } from "../src/orchestration/supervisor.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSearchWebTool } from "../src/tools/search-web.js";
import { createFetchPageTool } from "../src/tools/fetch-page.js";
import { createRecordEvidenceTool } from "../src/tools/record-evidence.js";
import { EvidenceStore } from "../src/research/evidence-store.js";
import type { ResearchJob } from "../src/types.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${msg}`);
  }
  console.log(`✅ ${msg}`);
}

async function runPhase4Tests() {
  console.log("\n🧪 RUNNING PHASE 4 PRODUCTION RELIABILITY TEST SUITE...\n");

  const repo = new ResearchRepository();

  // -------------------------------------------------------------
  // Test 1: Drizzle Repository & Idempotent Persistence
  // -------------------------------------------------------------
  console.log("--- 1. Testing Drizzle Repository & Idempotent Writes ---");
  const testJob: ResearchJob = {
    id: `job_persist_${Date.now()}`,
    topic: "Idempotent Database Persistence Test",
    scope: ["durability", "idempotency"],
    status: "queued",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    taskIds: ["t_1", "t_2"],
  };

  await repo.saveJob(testJob);
  const fetchedJob = await repo.getJob(testJob.id);
  assert(fetchedJob?.id === testJob.id, "Persists and retrieves research job");

  await repo.updateJobStatus(testJob.id, "researching");
  const updatedJob = await repo.getJob(testJob.id);
  assert(updatedJob?.status === "researching", "Updates job state machine status");

  // Idempotent Evidence writes
  const ev1 = {
    id: "ev_idemp_1",
    sourceId: "src_1",
    sourceUrl: "https://vllm.ai",
    sourceTitle: "vLLM",
    claim: "Continuous batching improves throughput",
    excerpt: "Exact verbatim passage",
    extractionMethod: "agent_extracted" as const,
  };

  await repo.saveEvidence(testJob.id, ev1);
  await repo.saveEvidence(testJob.id, ev1); // duplicate write!
  const evidenceList = (repo as any).memEvidence.get(testJob.id) || [];
  assert(evidenceList.length === 1, "Enforces evidence write idempotency (duplicate skipped)");

  // Idempotent Agent Run writes
  const run1 = {
    id: "run_1",
    jobId: testJob.id,
    taskId: "t_1",
    agentName: "web-agent",
    attempt: 1,
    modelName: "gpt-4o-mini",
    inputTokens: 300,
    outputTokens: 100,
    estimatedCostUsd: 0.0001,
    durationMs: 450,
    status: "completed" as const,
  };

  await repo.recordAgentRun(run1);
  await repo.recordAgentRun(run1); // duplicate attempt write!
  const runs = await repo.getRunsForJob(testJob.id);
  assert(runs.length === 1, "Enforces agent run idempotency on (jobId, taskId, attempt)");

  // -------------------------------------------------------------
  // Test 2: Bounded Retries with Exponential Backoff
  // -------------------------------------------------------------
  console.log("\n--- 2. Testing Bounded Retries & Backoff ---");
  let failureCount = 0;
  const { result, attempts } = await withRetry(
    async (attempt) => {
      if (attempt < 2) {
        failureCount++;
        throw new Error("HTTP 503 Service Unavailable: Search provider rate limited");
      }
      return "SUCCESS_DATA";
    },
    { maxAttempts: 3, baseDelayMs: 20 }
  );

  assert(result === "SUCCESS_DATA", "Successfully recovers from transient network failure");
  assert(attempts === 2, `Executed exact retry count (attempts: ${attempts}, failures: ${failureCount})`);

  // -------------------------------------------------------------
  // Test 3: Structured Tracing & Cost Accounting
  // -------------------------------------------------------------
  console.log("\n--- 3. Testing Structured Tracing & Cost Accounting ---");
  const tracer = new JobTracer("job_trace_123");
  tracer.emit("research.started", { metadata: { topic: "Test Topic" } });
  tracer.emit("tool.called", { toolName: "search_web" });
  tracer.emit("task.completed", {
    taskId: "t_1",
    agentName: "research-agent",
    durationMs: 350,
    tokens: { input: 1200, output: 400 },
  });

  const metrics = tracer.getMetrics();
  assert(metrics.totalEvents === 3, "Logs all structured lifecycle events");
  assert(metrics.totalTokens === 1600, "Accurately aggregates token consumption (1600 tokens)");
  assert(metrics.estimatedCostUsd > 0, `Computes USD cost estimate ($${metrics.estimatedCostUsd})`);

  // -------------------------------------------------------------
  // Test 4: Job Cancellation Support
  // -------------------------------------------------------------
  console.log("\n--- 4. Testing Job Cancellation & Abort Traps ---");
  const supervisor = new Supervisor({ repository: repo });
  const cancelJob: ResearchJob = {
    id: `job_cancel_${Date.now()}`,
    topic: "Cancellation Test Job",
    status: "queued",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    taskIds: [],
  };

  const cancelStore = new EvidenceStore();
  const cancelTools = new ToolRegistry();
  cancelTools.register(createSearchWebTool());
  cancelTools.register(createFetchPageTool());
  cancelTools.register(createRecordEvidenceTool(cancelStore));

  // Start job and immediately trigger cancellation
  const runPromise = supervisor.runJob(cancelJob, cancelTools, cancelStore);
  const cancelResult = supervisor.cancelJob(cancelJob.id);
  assert(cancelResult === true, "cancelJob successfully signals active AbortController");

  try {
    await runPromise;
  } catch (err: any) {
    assert(err.message.includes("cancelled"), "Aborts research job with cancellation error");
  }

  const cancelledStatus = await repo.getJob(cancelJob.id);
  assert(cancelledStatus?.status === "cancelled", "Transitions job status to 'cancelled' in storage");

  console.log("\n🎉 ALL PHASE 4 PRODUCTION RELIABILITY TESTS PASSED SUCCESSFULLY!\n");
}

runPhase4Tests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});

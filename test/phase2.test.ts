import { Planner } from "../src/orchestration/planner.js";
import { executeTaskGraph } from "../src/orchestration/task-graph.js";
import { Supervisor } from "../src/orchestration/supervisor.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createSearchWebTool } from "../src/tools/search-web.js";
import { createFetchPageTool } from "../src/tools/fetch-page.js";
import { createRecordEvidenceTool } from "../src/tools/record-evidence.js";
import { EvidenceStore } from "../src/research/evidence-store.js";
import type { ResearchJob, ResearchTask } from "../src/types.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${msg}`);
  }
  console.log(`✅ ${msg}`);
}

async function runPhase2Tests() {
  console.log("\n🧪 RUNNING PHASE 2 MULTI-AGENT TEST SUITE...\n");

  // -------------------------------------------------------------
  // Test 1: Supervisor Planner Decomposition
  // -------------------------------------------------------------
  console.log("--- 1. Testing Planner & Task Decomposition ---");
  const planner = new Planner();
  const testJob: ResearchJob = {
    id: "job_plan_test",
    topic: "Continuous batching and PagedAttention in vLLM",
    scope: ["throughput", "memory", "trade-offs"],
    status: "queued",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    taskIds: [],
  };

  const plan = await planner.createPlan(testJob);
  assert(plan.tasks.length >= 3, `Generates at least 3 tasks (generated: ${plan.tasks.length})`);
  assert(plan.tasks.length <= 6, "Respects max task budget constraint (<= 6 tasks)");
  assert(plan.tasks.some((t) => t.assignedAgent === "web-agent"), "Assigns task to web-agent");
  assert(plan.tasks.some((t) => t.assignedAgent === "research-agent"), "Assigns task to research-agent");
  assert(plan.tasks.some((t) => t.assignedAgent === "papers-agent"), "Assigns task to papers-agent");

  // -------------------------------------------------------------
  // Test 2: DAG Task Graph Dependencies & Bounded Concurrency
  // -------------------------------------------------------------
  console.log("\n--- 2. Testing DAG Scheduling & Bounded Concurrency ---");
  const executionOrder: string[] = [];
  let currentConcurrency = 0;
  let maxObservedConcurrency = 0;

  const mockTasks: ResearchTask[] = [
    {
      id: "task_A",
      jobId: "test",
      question: "Prerequisite task A",
      assignedAgent: "research-agent",
      dependsOn: [],
      status: "pending",
      resultIds: [],
    },
    {
      id: "task_B",
      jobId: "test",
      question: "Independent task B",
      assignedAgent: "web-agent",
      dependsOn: [],
      status: "pending",
      resultIds: [],
    },
    {
      id: "task_C",
      jobId: "test",
      question: "Dependent task C (requires A)",
      assignedAgent: "papers-agent",
      dependsOn: ["task_A"], // strictly depends on task_A
      status: "pending",
      resultIds: [],
    },
  ];

  const graphSummary = await executeTaskGraph({
    jobId: "test_job",
    tasks: mockTasks,
    maxConcurrency: 2, // limit to 2 simultaneous workers
    executeTask: async (task) => {
      currentConcurrency++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, currentConcurrency);

      // Simulate async network work
      await new Promise((resolve) => setTimeout(resolve, 50));

      executionOrder.push(task.id);
      currentConcurrency--;

      return {
        taskId: task.id,
        agentName: task.assignedAgent,
        status: "completed",
        evidenceCount: 1,
      };
    },
  });

  assert(maxObservedConcurrency <= 2, `Enforces maxConcurrency limit (observed: ${maxObservedConcurrency})`);
  assert(graphSummary.completedTasks.length === 3, "All tasks completed successfully");
  const idxA = executionOrder.indexOf("task_A");
  const idxC = executionOrder.indexOf("task_C");
  assert(idxA < idxC, `Task C strictly ran after prerequisite Task A (A at ${idxA}, C at ${idxC})`);

  // -------------------------------------------------------------
  // Test 3: Partial Failure Resilience & Fault Tolerance
  // -------------------------------------------------------------
  console.log("\n--- 3. Testing Partial Failure Resilience ---");
  const resilientTasks: ResearchTask[] = [
    {
      id: "fail_task_1",
      jobId: "resilience",
      question: "Unstable task that fails",
      assignedAgent: "web-agent",
      dependsOn: [],
      status: "pending",
      resultIds: [],
    },
    {
      id: "success_task_2",
      jobId: "resilience",
      question: "Healthy independent task",
      assignedAgent: "research-agent",
      dependsOn: [],
      status: "pending",
      resultIds: [],
    },
    {
      id: "dep_task_3",
      jobId: "resilience",
      question: "Task depending on the failing task",
      assignedAgent: "papers-agent",
      dependsOn: ["fail_task_1"],
      status: "pending",
      resultIds: [],
    },
  ];

  const partialSummary = await executeTaskGraph({
    jobId: "resilience_job",
    tasks: resilientTasks,
    maxConcurrency: 2,
    executeTask: async (task) => {
      if (task.id === "fail_task_1") {
        throw new Error("Simulated upstream provider timeout / rate limit");
      }
      return {
        taskId: task.id,
        agentName: task.assignedAgent,
        status: "completed",
        evidenceCount: 2,
      };
    },
  });

  assert(partialSummary.completedTasks.includes("success_task_2"), "Preserves healthy independent task results");
  assert(partialSummary.failedTasks.includes("fail_task_1"), "Identifies failed task");
  assert(partialSummary.failedTasks.includes("dep_task_3"), "Gracefully skips dependent task without crashing entire job");

  // -------------------------------------------------------------
  // Test 4: End-to-End Multi-Agent Supervisor Execution
  // -------------------------------------------------------------
  console.log("\n--- 4. Testing End-to-End Multi-Agent Supervisor Flow ---");
  const store = new EvidenceStore();
  const tools = new ToolRegistry();
  tools.register(createSearchWebTool());
  tools.register(createFetchPageTool());
  tools.register(createRecordEvidenceTool(store));

  const supervisor = new Supervisor({ maxConcurrency: 3, modelName: "gpt-4o-mini" });
  const e2eJob: ResearchJob = {
    id: `e2e_job_${Date.now()}`,
    topic: "Speculative decoding vs continuous batching in LLM serving",
    status: "queued",
    createdAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 120000).toISOString(),
    taskIds: [],
  };

  const { report, summary, tasks } = await supervisor.runJob(e2eJob, tools, store);

  assert(summary.completedTasks.length > 0, "Supervisor completes tasks across multiple agents");
  assert(report.claims.length > 0, "Produces grounded factual claims");
  assert(report.markdown.includes("Multi-Agent Execution Telemetry"), "Includes execution telemetry in report");
  assert(tasks.some((t) => t.status === "completed"), "Marks tasks complete in state machine");

  console.log("\n🎉 ALL PHASE 2 MULTI-AGENT TESTS PASSED SUCCESSFULLY!\n");
}

runPhase2Tests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});

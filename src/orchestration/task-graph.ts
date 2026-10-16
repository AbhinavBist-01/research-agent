import type { ResearchTask } from "../types.js";
import type { TaskExecutionResult } from "../agents/base-agent.js";

export interface TaskGraphOptions {
  jobId: string;
  tasks: ResearchTask[];
  maxConcurrency?: number;
  deadlineAt?: string;
  executeTask: (task: ResearchTask) => Promise<TaskExecutionResult>;
}

export interface TaskGraphSummary {
  totalTasks: number;
  completedTasks: string[];
  failedTasks: string[];
  results: TaskExecutionResult[];
  durationMs: number;
}

/**
 * Directed Acyclic Graph (DAG) Task Scheduler with Bounded Concurrency and Partial Failure Resilience
 */
export async function executeTaskGraph(options: TaskGraphOptions): Promise<TaskGraphSummary> {
  const { tasks, executeTask, maxConcurrency = 3, deadlineAt } = options;
  const startTime = Date.now();

  const taskMap = new Map<string, ResearchTask>(tasks.map((t) => [t.id, t]));
  const completedTaskIds = new Set<string>();
  const failedTaskIds = new Set<string>();
  const activePromises = new Map<string, Promise<TaskExecutionResult>>();
  const allResults: TaskExecutionResult[] = [];

  console.log(`[TaskGraph] Initialized graph with ${tasks.length} tasks (maxConcurrency: ${maxConcurrency}).`);

  while (completedTaskIds.size + failedTaskIds.size < tasks.length) {
    // Check deadline expiration
    if (deadlineAt && new Date().getTime() > new Date(deadlineAt).getTime()) {
      console.warn(`[TaskGraph] Research deadline reached! Aborting pending tasks.`);
      for (const t of tasks) {
        if (!completedTaskIds.has(t.id) && !failedTaskIds.has(t.id)) {
          t.status = "failed";
          failedTaskIds.add(t.id);
          allResults.push({
            taskId: t.id,
            agentName: t.assignedAgent,
            status: "failed",
            evidenceCount: 0,
            error: "Job deadline exceeded before task execution could finish.",
          });
        }
      }
      break;
    }

    // 1. Find all pending tasks ready to run (all dependencies satisfied)
    const readyTasks: ResearchTask[] = [];

    for (const task of tasks) {
      if (task.status !== "pending") continue;

      const deps = task.dependsOn || [];

      // Check if any upstream dependency failed
      const hasFailedDep = deps.some((depId) => failedTaskIds.has(depId));
      if (hasFailedDep) {
        console.warn(`[TaskGraph] Task ${task.id} skipped because upstream dependency failed.`);
        task.status = "failed";
        failedTaskIds.add(task.id);
        allResults.push({
          taskId: task.id,
          agentName: task.assignedAgent,
          status: "failed",
          evidenceCount: 0,
          error: "Upstream prerequisite task failed.",
        });
        continue;
      }

      // Check if all dependencies completed successfully
      const allDepsCompleted = deps.every((depId) => completedTaskIds.has(depId));
      if (allDepsCompleted) {
        readyTasks.push(task);
      }
    }

    // 2. Launch ready tasks up to available concurrency slots
    const availableSlots = maxConcurrency - activePromises.size;
    const tasksToLaunch = readyTasks.slice(0, availableSlots);

    for (const task of tasksToLaunch) {
      task.status = "running";
      console.log(`[TaskGraph] 🚀 Dispatching Task ${task.id} to ${task.assignedAgent} (in parallel)`);

      const promise = executeTask(task);
      activePromises.set(task.id, promise);
    }

    // If nothing is running and no new tasks can be dispatched, we may have a deadlock or completed
    if (activePromises.size === 0) {
      const remaining = tasks.filter((t) => !completedTaskIds.has(t.id) && !failedTaskIds.has(t.id));
      if (remaining.length > 0) {
        console.error(`[TaskGraph] Deadlock detected! Unable to satisfy dependencies for: ${remaining.map((t) => t.id).join(", ")}`);
        for (const t of remaining) {
          t.status = "failed";
          failedTaskIds.add(t.id);
        }
      }
      break;
    }

    // 3. Wait for at least one active task to settle using Promise.race (or settled race)
    const settledResult = await Promise.race(
      Array.from(activePromises.entries()).map(async ([id, p]) => {
        try {
          const res = await p;
          return { id, res, isError: false };
        } catch (err: any) {
          return { id, res: err, isError: true };
        }
      })
    );

    // Remove settled task from active pool
    activePromises.delete(settledResult.id);
    const targetTask = taskMap.get(settledResult.id)!;

    if (!settledResult.isError && settledResult.res.status === "completed") {
      targetTask.status = "completed";
      completedTaskIds.add(targetTask.id);
      allResults.push(settledResult.res);
      console.log(`[TaskGraph] ✅ Task ${targetTask.id} completed successfully (+${settledResult.res.evidenceCount} evidence items).`);
    } else {
      targetTask.status = "failed";
      failedTaskIds.add(targetTask.id);
      const errorMsg = settledResult.isError
        ? settledResult.res?.message || String(settledResult.res)
        : settledResult.res.error || "Unknown task failure";
      allResults.push({
        taskId: targetTask.id,
        agentName: targetTask.assignedAgent,
        status: "failed",
        evidenceCount: settledResult.res?.evidenceCount || 0,
        error: errorMsg,
      });
      console.warn(`[TaskGraph] ⚠️ Task ${targetTask.id} failed: ${errorMsg}. Preserving work from other tasks.`);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[TaskGraph] Execution settled in ${durationMs}ms. Completed: ${completedTaskIds.size}, Failed: ${failedTaskIds.size}.`);

  return {
    totalTasks: tasks.length,
    completedTasks: Array.from(completedTaskIds),
    failedTasks: Array.from(failedTaskIds),
    results: allResults,
    durationMs,
  };
}

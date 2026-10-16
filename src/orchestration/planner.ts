import OpenAI from "openai";
import type { ResearchJob, ResearchTask } from "../types.js";

export interface ResearchPlan {
  jobId: string;
  topic: string;
  tasks: ResearchTask[];
}

export class Planner {
  private openai: OpenAI | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    }
    this.modelName = modelName || process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  /**
   * Creates a structured research plan with bounded tasks and explicit dependencies
   */
  async createPlan(job: ResearchJob): Promise<ResearchPlan> {
    console.log(`[Planner] Decomposing topic into specialized tasks: "${job.topic}"`);

    if (this.openai) {
      try {
        const tasks = await this.planWithLLM(job);
        this.validatePlan(tasks);
        return {
          jobId: job.id,
          topic: job.topic,
          tasks,
        };
      } catch (err: any) {
        console.warn(`[Planner] LLM decomposition failed (${err.message}). Using deterministic planner.`);
      }
    }

    const tasks = this.planDeterministic(job);
    this.validatePlan(tasks);
    return {
      jobId: job.id,
      topic: job.topic,
      tasks,
    };
  }

  private async planWithLLM(job: ResearchJob): Promise<ResearchTask[]> {
    const prompt = `You are a Lead Research Orchestrator.
Decompose the following research topic into 3 to 4 distinct sub-tasks for specialized agents.

Research Topic: "${job.topic}"
${job.scope ? `Requested Scope: ${job.scope.join(", ")}` : ""}

Available Specialized Agents:
- "web-agent": Current web sources, benchmarks, framework documentation, engineering blogs.
- "research-agent": Core mechanisms, architectural comparisons, latency and memory trade-offs.
- "papers-agent": Primary scientific papers, ArXiv preprints, academic conference findings.

Rules:
1. Generate between 3 and 4 focused tasks.
2. Independent tasks must have "dependsOn": [] so they can run concurrently.
3. Only add a dependency if a task strictly needs upstream results.
4. Respond in valid JSON adhering strictly to this schema:
{
  "tasks": [
    {
      "id": "t_1",
      "question": "What is ...?",
      "assignedAgent": "research-agent",
      "dependsOn": []
    }
  ]
}`;

    const completion = await this.openai!.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: "system", content: "You are an AI research workflow planner. Always respond with pure JSON." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];

    return rawTasks.map((t: any, idx: number) => ({
      id: t.id || `t_${idx + 1}`,
      jobId: job.id,
      question: t.question,
      assignedAgent: ["web-agent", "research-agent", "papers-agent"].includes(t.assignedAgent)
        ? t.assignedAgent
        : "research-agent",
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      status: "pending" as const,
      resultIds: [],
    }));
  }

  private planDeterministic(job: ResearchJob): ResearchTask[] {
    return [
      {
        id: "t_1",
        jobId: job.id,
        question: `What are the core technical concepts, definitions, and mechanisms of ${job.topic}?`,
        assignedAgent: "research-agent",
        dependsOn: [],
        status: "pending",
        resultIds: [],
      },
      {
        id: "t_2",
        jobId: job.id,
        question: `What empirical benchmarks, speedups, and industry deployment numbers are reported for ${job.topic}?`,
        assignedAgent: "web-agent",
        dependsOn: [],
        status: "pending",
        resultIds: [],
      },
      {
        id: "t_3",
        jobId: job.id,
        question: `What do foundational papers (ArXiv, conferences) establish about the design and formal trade-offs of ${job.topic}?`,
        assignedAgent: "papers-agent",
        dependsOn: [],
        status: "pending",
        resultIds: [],
      },
      {
        id: "t_4",
        jobId: job.id,
        question: `What are the key trade-offs (memory, latency, edge cases) and contradictions in ${job.topic}?`,
        assignedAgent: "research-agent",
        dependsOn: ["t_1"], // Dependent on t_1 completion
        status: "pending",
        resultIds: [],
      },
    ];
  }

  /**
   * Code-level validation of the proposed plan (prevent runaway task explosion or circular DAGs)
   */
  private validatePlan(tasks: ResearchTask[]): void {
    if (tasks.length === 0) {
      throw new Error("Plan validation error: No tasks generated.");
    }
    if (tasks.length > 6) {
      throw new Error(`Plan validation error: Task count (${tasks.length}) exceeds budget ceiling of 6 tasks.`);
    }

    const taskIds = new Set(tasks.map((t) => t.id));

    // Ensure all dependsOn reference real tasks and no self-dependency
    for (const task of tasks) {
      for (const dep of task.dependsOn || []) {
        if (dep === task.id) {
          throw new Error(`Plan validation error: Task ${task.id} cannot depend on itself.`);
        }
        if (!taskIds.has(dep)) {
          throw new Error(`Plan validation error: Task ${task.id} depends on unknown task ${dep}.`);
        }
      }
    }
  }
}

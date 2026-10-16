import OpenAI from "openai";
import type { ToolRegistry } from "../tools/registry.js";
import type { EvidenceStore } from "../research/evidence-store.js";
import type { ResearchTask } from "../types.js";

export interface AgentContext {
  jobId: string;
  topic: string;
  task: ResearchTask;
  deadlineAt?: string;
}

export interface TaskExecutionResult {
  taskId: string;
  agentName: string;
  status: "completed" | "failed";
  evidenceCount: number;
  error?: string;
}

export abstract class BaseAgent {
  public abstract readonly name: string;
  public abstract readonly role: string;
  protected openai: OpenAI | null = null;
  protected modelName: string;
  protected maxIterations: number;

  constructor(
    options: {
      apiKey?: string | undefined;
      modelName?: string | undefined;
      maxIterations?: number | undefined;
    } = {}
  ) {
    const key = options.apiKey || process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    }
    this.modelName = options.modelName || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.maxIterations = options.maxIterations || 5;
  }

  /**
   * Abstract method for agent-specific system prompt instructions
   */
  protected abstract getSystemPrompt(context: AgentContext): string;

  /**
   * Deterministic fallback when OpenAI API key is unavailable
   */
  protected abstract runDeterministic(
    context: AgentContext,
    tools: ToolRegistry,
    store: EvidenceStore
  ): Promise<TaskExecutionResult>;

  /**
   * Core execution loop for this agent
   */
  async execute(
    context: AgentContext,
    tools: ToolRegistry,
    store: EvidenceStore
  ): Promise<TaskExecutionResult> {
    const startEvidenceCount = store.getAllEvidence().length;
    console.log(`[${this.name}] Starting Task ${context.task.id}: "${context.task.question}"`);

    if (!this.openai) {
      console.warn(`[${this.name}] OPENAI_API_KEY not configured. Executing fallback research.`);
      return this.runDeterministic(context, tools, store);
    }

    try {
      const systemPrompt = this.getSystemPrompt(context);
      const messages: OpenAI.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Overarching Topic: "${context.topic}"\nYour Assigned Sub-Question: "${context.task.question}"\n\nInvestigate this sub-question using available tools and record factual evidence with exact quotes.`,
        },
      ];

      for (let step = 1; step <= this.maxIterations; step++) {
        console.log(`[${this.name}] [Task ${context.task.id}] Step ${step}/${this.maxIterations}...`);

        const completion = await this.openai.chat.completions.create({
          model: this.modelName,
          messages,
          tools: tools.getOpenAITools(),
          tool_choice: "auto",
          temperature: 0.1,
        });

        const responseMessage = completion.choices[0]?.message;
        if (!responseMessage) break;

        messages.push(responseMessage);

        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
          console.log(`[${this.name}] Concluded research for Task ${context.task.id} after ${step} steps.`);
          break;
        }

        // Execute proposed tool calls
        for (const call of responseMessage.tool_calls) {
          if (call.type !== "function") continue;

          const toolName = call.function.name;
          let toolArgs: any = {};
          try {
            toolArgs = JSON.parse(call.function.arguments);
          } catch (e: any) {
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify({ error: `Malformed JSON arguments: ${e.message}` }),
            });
            continue;
          }

          console.log(`[${this.name}] Calling tool '${toolName}'...`);
          const result = await tools.execute(toolName, toolArgs, {
            jobId: context.jobId,
            taskId: context.task.id,
          });

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(result.success ? result.data : { error: result.error }),
          });
        }
      }

      const newEvidenceCount = store.getAllEvidence().length - startEvidenceCount;
      return {
        taskId: context.task.id,
        agentName: this.name,
        status: "completed",
        evidenceCount: newEvidenceCount,
      };
    } catch (err: any) {
      console.error(`[${this.name}] Task ${context.task.id} encountered an error:`, err?.message || err);
      return {
        taskId: context.task.id,
        agentName: this.name,
        status: "failed",
        evidenceCount: store.getAllEvidence().length - startEvidenceCount,
        error: err?.message || String(err),
      };
    }
  }
}

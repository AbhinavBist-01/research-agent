import OpenAI from "openai";
import type { ToolRegistry } from "../tools/registry.js";
import type { EvidenceStore } from "./evidence-store.js";
import { Synthesizer } from "./synthesizer.js";
import type { ResearchReport, ResearchJob } from "../types.js";

export interface SingleAgentOptions {
  apiKey?: string;
  modelName?: string;
  maxIterations?: number;
}

export class SingleAgent {
  private openai: OpenAI | null = null;
  private modelName: string;
  private maxIterations: number;
  private synthesizer: Synthesizer;

  constructor(options: SingleAgentOptions = {}) {
    const key = options.apiKey || process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    }
    this.modelName = options.modelName || "gpt-5.6-luna";
    this.maxIterations = options.maxIterations || 6;
    this.synthesizer = new Synthesizer(key, this.modelName);
  }

  /**
   * Runs the complete research loop for a given job and topic
   */
  async runResearch(
    job: ResearchJob,
    tools: ToolRegistry,
    store: EvidenceStore,
  ): Promise<ResearchReport> {
    console.log(
      `[SingleAgent] Starting research for Job ${job.id}: "${job.topic}"`,
    );

    if (this.openai) {
      await this.runLLMResearchLoop(job, tools, store);
    } else {
      console.warn(
        "[SingleAgent] OPENAI_API_KEY not found. Running deterministic multi-step research loop.",
      );
      await this.runDeterministicResearchLoop(job, tools, store);
    }

    console.log(
      `[SingleAgent] Evidence collection complete (${store.getAllEvidence().length} items). Synthesizing report...`,
    );
    const report = await this.synthesizer.synthesize(job.id, job.topic, store);
    return report;
  }

  private async runLLMResearchLoop(
    job: ResearchJob,
    tools: ToolRegistry,
    store: EvidenceStore,
  ): Promise<void> {
    const systemPrompt = `You are a rigorous Research Agent.
Your goal is to thoroughly investigate the user's research topic using available tools.

Workflow instructions:
1. Formulate search queries and call 'search_web' to discover authoritative sources.
2. If necessary, call 'fetch_page' to read deep content from promising URLs.
3. Call 'record_evidence' for every key factual claim, benchmark, or trade-off you uncover, supplying the exact quotation.
4. When you have collected at least 3-5 solid pieces of evidence covering both advantages, mechanisms, and trade-offs, stop calling tools and summarize your findings.

Do NOT guess or fabricate facts. All claims must be recorded with authentic excerpts via 'record_evidence'.`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Research question: ${job.topic}` },
    ];

    for (let step = 1; step <= this.maxIterations; step++) {
      console.log(`[SingleAgent] Iteration ${step}/${this.maxIterations}...`);

      const completion = await this.openai!.chat.completions.create({
        model: this.modelName,
        messages,
        tools: tools.getOpenAITools(),
        tool_choice: "auto",
        temperature: 0.1,
      });

      const responseMessage = completion.choices[0]?.message;
      if (!responseMessage) break;

      messages.push(responseMessage);

      // If the model did not propose any tool calls, it has finished investigating
      if (
        !responseMessage.tool_calls ||
        responseMessage.tool_calls.length === 0
      ) {
        console.log(
          `[SingleAgent] Model concluded research after ${step} iterations.`,
        );
        break;
      }

      // Execute each proposed tool call
      for (const call of responseMessage.tool_calls) {
        if (call.type !== "function") continue;

        const toolName = call.function.name;
        let toolArgs: any = {};
        try {
          toolArgs = JSON.parse(call.function.arguments);
        } catch (e: any) {
          console.warn(
            `[SingleAgent] Failed to parse JSON arguments for tool ${toolName}:`,
            e.message,
          );
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              error: `Malformed JSON arguments: ${e.message}`,
            }),
          });
          continue;
        }

        console.log(`[SingleAgent] Executing tool '${toolName}'...`);
        const execution = await tools.execute(toolName, toolArgs, {
          jobId: job.id,
        });

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(
            execution.success ? execution.data : { error: execution.error },
          ),
        });
      }
    }
  }

  /**
   * Deterministic research path when OpenAI API key is not configured
   */
  private async runDeterministicResearchLoop(
    job: ResearchJob,
    tools: ToolRegistry,
    store: EvidenceStore,
  ): Promise<void> {
    // 1. Search for topic
    console.log(`[SingleAgent] Searching web for "${job.topic}"...`);
    const searchRes = await tools.execute(
      "search_web",
      { query: job.topic, maxResults: 3 },
      { jobId: job.id },
    );

    if (!searchRes.success || !searchRes.data?.results) {
      console.warn(
        "[SingleAgent] Search failed or returned no results:",
        searchRes.error,
      );
      return;
    }

    const results = searchRes.data.results;
    for (const item of results) {
      console.log(
        `[SingleAgent] Extracting evidence from source: "${item.title}"`,
      );
      await tools.execute(
        "record_evidence",
        {
          sourceUrl: item.url,
          sourceTitle: item.title,
          claim: item.title,
          excerpt: item.content,
        },
        { jobId: job.id },
      );
    }
  }
}

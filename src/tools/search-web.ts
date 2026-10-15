import { z } from "zod";
import { tavily } from "@tavily/core";
import type { ToolDefinition } from "../types.js";

const SearchInputSchema = z.object({
  query: z.string().describe("The precise search query to discover articles, technical papers, or documentation"),
  maxResults: z.number().optional().default(5).describe("Maximum number of results to retrieve (1-10)"),
});

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export function createSearchWebTool(): ToolDefinition<z.infer<typeof SearchInputSchema>, { query: string; results: SearchResultItem[] }> {
  return {
    name: "search_web",
    description: "Search the web for technical documentation, academic literature, benchmarks, or articles related to a research topic.",
    schema: SearchInputSchema,
    async execute(input) {
      const apiKey = process.env.TAVILY_API_KEY;

      if (!apiKey) {
        console.warn("[search_web] TAVILY_API_KEY is missing. Providing fallback mock technical results.");
        return {
          query: input.query,
          results: [
            {
              title: "Continuous Batching in High-Throughput LLM Inference (vLLM Paper)",
              url: "https://arxiv.org/abs/2309.06180",
              content:
                "Continuous batching (or iteration-level batching) processes requests at the granularity of iterations rather than request lifecycles. New requests join the batch immediately as tokens are generated, and completed requests vacate memory immediately. Benchmarks show up to 2x-4x throughput improvements over static batching on varied sequence length workloads.",
            },
            {
              title: "Orca: A Distributed Serving System for Transformer-Based Generative Models",
              url: "https://www.usenix.org/conference/osdi22/presentation/yu",
              content:
                "Orca introduces iteration-level scheduling to eliminate bubbles caused by uneven sequence lengths in static batching. The trade-off is slightly increased scheduling overhead and potential cache fragmentation, but overall GPU accelerator utilization is maximized.",
            },
            {
              title: "Comparing Static Batching vs Continuous Batching Trade-offs",
              url: "https://anyscale.com/blog/continuous-batching-llm-serving",
              content:
                "While static batching holds a fixed set of requests until all have finished generating (causing GPU underutilization due to early finishes), continuous batching continuously injects and evicts requests. Trade-offs include higher variance in first-token latency (TTFT) under saturation and increased KV cache management complexity.",
            },
          ],
        };
      }

      const client = tavily({ apiKey });
      const response = await client.search(input.query, {
        maxResults: input.maxResults || 5,
        searchDepth: "basic",
      });

      const results: SearchResultItem[] = (response.results || []).map((item) => ({
        title: item.title,
        url: item.url,
        content: item.content,
        score: item.score,
      }));

      return {
        query: input.query,
        results,
      };
    },
  };
}

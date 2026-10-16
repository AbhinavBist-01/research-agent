export interface BenchmarkItem {
  id: string;
  topic: string;
  category: "architecture" | "trade_offs" | "literature" | "recent_advances";
  expectedScope: string[];
  referenceKeyFacts: string[];
  expectedKeywords: string[];
}

export const BENCHMARK_QUESTIONS: BenchmarkItem[] = [
  {
    id: "bench_1",
    topic: "Continuous batching in LLM inference and how it compares with static batching",
    category: "architecture",
    expectedScope: ["iteration-level scheduling", "throughput", "GPU utilization", "static batching bubbles"],
    referenceKeyFacts: [
      "Continuous batching schedules at the iteration level rather than request level",
      "Eliminates GPU underutilization bubbles caused by variable sequence lengths",
      "Achieves higher throughput over static batching on varied workloads",
    ],
    expectedKeywords: ["continuous", "batching", "iteration", "static", "throughput", "gpu"],
  },
  {
    id: "bench_2",
    topic: "FlashAttention-3 asynchrony, low-precision FP8, and performance gains on NVIDIA Hopper",
    category: "literature",
    expectedScope: ["Hopper H100", "FP8 low-precision", "Tensor Cores asynchrony", "TMA"],
    referenceKeyFacts: [
      "Exploits Tensor Memory Accelerator (TMA) and asynchronous copy instructions",
      "Reaches up to 75% GPU utilization on H100",
      "Supports FP8 low-precision matrix multiplication while preserving numerical accuracy",
    ],
    expectedKeywords: ["flashattention", "hopper", "fp8", "asynchrony", "utilization"],
  },
  {
    id: "bench_3",
    topic: "PagedAttention memory fragmentation and virtual memory management in vLLM",
    category: "architecture",
    expectedScope: ["KV cache fragmentation", "virtual memory paging", "vLLM", "memory waste"],
    referenceKeyFacts: [
      "Inspired by OS virtual memory paging to manage KV cache non-contiguously",
      "Reduces KV cache waste from 60-80% down to under 4%",
      "Enables higher batch sizes and concurrent request sharing",
    ],
    expectedKeywords: ["pagedattention", "kv cache", "fragmentation", "virtual memory", "vllm"],
  },
  {
    id: "bench_4",
    topic: "Speculative decoding latency reduction vs verification compute trade-offs",
    category: "trade_offs",
    expectedScope: ["draft model", "target model verification", "acceptance rate", "memory overhead"],
    referenceKeyFacts: [
      "Uses a smaller draft model to generate candidate tokens in parallel",
      "Target model verifies all drafted tokens in a single forward pass",
      "Effective speedup depends on draft acceptance rate and batch concurrency",
    ],
    expectedKeywords: ["speculative decoding", "draft model", "verification", "acceptance rate", "latency"],
  },
  {
    id: "bench_5",
    topic: "Multi-Head Latent Attention (MLA) architecture and KV cache compression in DeepSeek",
    category: "recent_advances",
    expectedScope: ["MLA", "DeepSeek", "low-rank key-value compression", "RoPE decoupling"],
    referenceKeyFacts: [
      "Compresses KV cache into low-rank latent vectors to reduce serving memory",
      "Decouples positional embeddings (RoPE) to preserve attention quality",
      "Allows serving much larger context windows and higher concurrency on accelerators",
    ],
    expectedKeywords: ["mla", "latent attention", "deepseek", "kv cache", "compression"],
  },
];

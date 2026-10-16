import { BENCHMARK_QUESTIONS } from "../src/evaluation/benchmark-data.js";
import { MetricsCalculator } from "../src/evaluation/metrics.js";
import { EvaluationRunner } from "../src/evaluation/runner.js";
import type { ResearchReport } from "../src/types.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${msg}`);
  }
  console.log(`✅ ${msg}`);
}

async function runPhase5Tests() {
  console.log("\n🧪 RUNNING PHASE 5 BENCHMARK & EVALUATION TEST SUITE...\n");

  // -------------------------------------------------------------
  // Test 1: Benchmark Dataset Integrity
  // -------------------------------------------------------------
  console.log("--- 1. Testing Benchmark Dataset ---");
  assert(BENCHMARK_QUESTIONS.length >= 5, `Benchmark contains at least 5 curated topics (has ${BENCHMARK_QUESTIONS.length})`);
  assert(
    BENCHMARK_QUESTIONS.every((b) => b.expectedScope.length > 0 && b.referenceKeyFacts.length > 0),
    "Every benchmark item contains explicit scope and reference facts"
  );

  // -------------------------------------------------------------
  // Test 2: Core Metric Calculation (Precision, Coverage, Sufficiency)
  // -------------------------------------------------------------
  console.log("\n--- 2. Testing Core Metrics Calculation ---");
  const sampleReport: ResearchReport = {
    jobId: "sample_eval",
    topic: "Continuous batching in LLM inference",
    summary: "Continuous batching improves GPU throughput over static batching at the iteration level.",
    claims: [
      { id: "c1", text: "Continuous batching schedules tokens at each iteration", evidenceIds: ["ev1"], verificationStatus: "supported" },
      { id: "c2", text: "Improves GPU accelerator utilization", evidenceIds: ["ev2"], verificationStatus: "supported" },
      { id: "c3", text: "Tail latency may increase under short bursts", evidenceIds: ["ev3"], verificationStatus: "partially_supported" },
      { id: "c4", text: "Unverified statement", evidenceIds: [], verificationStatus: "unsupported" },
    ],
    evidence: [],
    sources: [
      { id: "s1", url: "https://vllm.ai", title: "vLLM", content: "", contentHash: "h1", retrievedAt: "", fetchStatus: "success" },
      { id: "s2", url: "https://anyscale.com", title: "Anyscale", content: "", contentHash: "h2", retrievedAt: "", fetchStatus: "success" },
    ],
    markdown: "...",
    createdAt: new Date().toISOString(),
  };

  const precision = MetricsCalculator.calculateCitationPrecision(sampleReport);
  // (1 + 1 + 0.5 + 0) / 4 = 2.5 / 4 = 0.625
  assert(precision === 0.625, `Calculates exact citation precision (${precision} === 0.625)`);

  const item1 = BENCHMARK_QUESTIONS[0]!;
  const coverage = MetricsCalculator.calculateCoverage(sampleReport, item1);
  assert(coverage > 0.5, `Evaluates research coverage against keywords (coverage: ${(coverage * 100).toFixed(1)}%)`);

  const sufficiency = MetricsCalculator.calculateEvidenceSufficiency(sampleReport);
  assert(sufficiency === 0.5, `Calculates evidence sufficiency (${sufficiency} sources/claim)`);

  // -------------------------------------------------------------
  // Test 3: Aggregation & P95 / Median Distributions
  // -------------------------------------------------------------
  console.log("\n--- 3. Testing Metric Aggregation (Median, P95) ---");
  const agg = MetricsCalculator.aggregate([
    {
      jobId: "1",
      topic: "Topic 1",
      factualAccuracy: 0.9,
      citationPrecision: 0.8,
      researchCoverage: 0.7,
      evidenceSufficiency: 0.5,
      latencyMs: 1000,
      estimatedCostUsd: 0.0002,
      totalTokens: 1000,
      toolSuccessRate: 1.0,
    },
    {
      jobId: "2",
      topic: "Topic 2",
      factualAccuracy: 0.95,
      citationPrecision: 0.9,
      researchCoverage: 0.8,
      evidenceSufficiency: 0.6,
      latencyMs: 1500,
      estimatedCostUsd: 0.0003,
      totalTokens: 1500,
      toolSuccessRate: 1.0,
    },
    {
      jobId: "3",
      topic: "Topic 3",
      factualAccuracy: 1.0,
      citationPrecision: 1.0,
      researchCoverage: 0.9,
      evidenceSufficiency: 0.7,
      latencyMs: 3000,
      estimatedCostUsd: 0.0005,
      totalTokens: 2500,
      toolSuccessRate: 1.0,
    },
  ]);

  assert(agg.medianLatencyMs === 1500, `Calculates median latency accurately (${agg.medianLatencyMs}ms)`);
  assert(agg.p95LatencyMs === 3000, `Calculates p95 latency accurately (${agg.p95LatencyMs}ms)`);
  assert(agg.meanCitationPrecision === 0.9, `Calculates mean citation precision (${agg.meanCitationPrecision})`);

  // -------------------------------------------------------------
  // Test 4: Comparative Evaluation Benchmark Execution
  // -------------------------------------------------------------
  console.log("\n--- 4. Running Comparative Benchmark (Single-Agent vs Multi-Agent) ---");
  const runner = new EvaluationRunner();
  const comparativeResult = await runner.runComparativeBenchmark(BENCHMARK_QUESTIONS.slice(0, 1));

  assert(comparativeResult.singleAgent.totalReportsEvaluated === 1, "Single-Agent benchmark finished 1 run");
  assert(comparativeResult.multiAgent.totalReportsEvaluated === 1, "Multi-Agent benchmark finished 1 run");

  const table = EvaluationRunner.renderComparisonTable(comparativeResult);
  console.log(table);

  console.log("\n🎉 ALL PHASE 5 BENCHMARK & EVALUATION TESTS PASSED SUCCESSFULLY!\n");
}

runPhase5Tests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});

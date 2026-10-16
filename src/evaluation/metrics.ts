import type { ResearchReport } from "../types.js";
import type { BenchmarkItem } from "./benchmark-data.js";

export interface EvaluationMetricsResult {
  jobId: string;
  topic: string;
  factualAccuracy: number; // 0 - 1.0
  citationPrecision: number; // 0 - 1.0
  researchCoverage: number; // 0 - 1.0
  evidenceSufficiency: number; // ratio of sources to claims
  latencyMs: number;
  estimatedCostUsd: number;
  totalTokens: number;
  toolSuccessRate: number; // 0 - 1.0
}

export interface AggregatedMetrics {
  totalReportsEvaluated: number;
  meanFactualAccuracy: number;
  meanCitationPrecision: number;
  meanResearchCoverage: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  meanCostUsd: number;
  overallToolSuccessRate: number;
}

export class MetricsCalculator {
  /**
   * Computes citation precision: (supported claims + 0.5 * partially supported) / total claims
   */
  static calculateCitationPrecision(report: ResearchReport): number {
    if (report.claims.length === 0) return 0;

    let score = 0;
    for (const claim of report.claims) {
      if (claim.verificationStatus === "supported") score += 1.0;
      else if (claim.verificationStatus === "partially_supported") score += 0.5;
    }
    return Number((score / report.claims.length).toFixed(4));
  }

  /**
   * Computes research coverage against benchmark expected scope and keywords
   */
  static calculateCoverage(report: ResearchReport, benchmark: BenchmarkItem): number {
    const reportText = (report.summary + " " + report.claims.map((c) => c.text).join(" ")).toLowerCase();
    const keywords = benchmark.expectedKeywords;

    if (keywords.length === 0) return 1.0;

    let hits = 0;
    for (const kw of keywords) {
      if (reportText.includes(kw.toLowerCase())) {
        hits++;
      }
    }

    return Number((hits / keywords.length).toFixed(4));
  }

  /**
   * Evaluates evidence sufficiency (number of unique verified sources supporting claims)
   */
  static calculateEvidenceSufficiency(report: ResearchReport): number {
    if (report.claims.length === 0) return 0;
    const uniqueSources = report.sources.filter((s) => s.fetchStatus === "success").length;
    // Healthy target is ~0.6 to 1.5 sources per claim
    return Number((uniqueSources / report.claims.length).toFixed(2));
  }

  /**
   * Aggregates a batch of evaluation results into summary distribution stats
   */
  static aggregate(results: EvaluationMetricsResult[]): AggregatedMetrics {
    if (results.length === 0) {
      return {
        totalReportsEvaluated: 0,
        meanFactualAccuracy: 0,
        meanCitationPrecision: 0,
        meanResearchCoverage: 0,
        medianLatencyMs: 0,
        p95LatencyMs: 0,
        meanCostUsd: 0,
        overallToolSuccessRate: 0,
      };
    }

    const accuracies = results.map((r) => r.factualAccuracy);
    const precisions = results.map((r) => r.citationPrecision);
    const coverages = results.map((r) => r.researchCoverage);
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const costs = results.map((r) => r.estimatedCostUsd);
    const toolRates = results.map((r) => r.toolSuccessRate);

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const medianLatency =
      latencies.length % 2 === 0
        ? (latencies[latencies.length / 2 - 1]! + latencies[latencies.length / 2]!) / 2
        : latencies[Math.floor(latencies.length / 2)]!;

    const p95Idx = Math.floor(latencies.length * 0.95);
    const p95Latency = latencies[p95Idx] || latencies[latencies.length - 1]!;

    return {
      totalReportsEvaluated: results.length,
      meanFactualAccuracy: Number(mean(accuracies).toFixed(4)),
      meanCitationPrecision: Number(mean(precisions).toFixed(4)),
      meanResearchCoverage: Number(mean(coverages).toFixed(4)),
      medianLatencyMs: Math.round(medianLatency),
      p95LatencyMs: Math.round(p95Latency),
      meanCostUsd: Number(mean(costs).toFixed(5)),
      overallToolSuccessRate: Number(mean(toolRates).toFixed(4)),
    };
  }
}

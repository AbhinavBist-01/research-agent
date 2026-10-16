import OpenAI from "openai";
import type { ReportClaim, Evidence } from "../types.js";

export interface ContradictionReport {
  conflictingClaimIds: [string, string];
  topic: string;
  divergenceReason: "different_metrics" | "different_workloads" | "hardware_difference" | "direct_contradiction";
  resolution: string;
}

export class ContradictionResolver {
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
   * Scans a set of claims and evidence for apparent contradictions and clarifies conditions
   */
  async resolveContradictions(
    claims: ReportClaim[],
    evidenceMap: Map<string, Evidence>
  ): Promise<{ resolvedClaims: ReportClaim[]; detectedContradictions: ContradictionReport[] }> {
    if (claims.length < 2) {
      return { resolvedClaims: claims, detectedContradictions: [] };
    }

    if (this.openai) {
      try {
        return await this.resolveWithLLM(claims, evidenceMap);
      } catch (err: any) {
        console.warn(`[ContradictionResolver] LLM analysis failed (${err.message}). Using rule-based detection.`);
      }
    }

    return this.resolveRuleBased(claims);
  }

  private async resolveWithLLM(
    claims: ReportClaim[],
    evidenceMap: Map<string, Evidence>
  ): Promise<{ resolvedClaims: ReportClaim[]; detectedContradictions: ContradictionReport[] }> {
    const claimsContext = claims
      .map((c) => {
        const evSnippets = c.evidenceIds
          .map((id) => evidenceMap.get(id)?.excerpt || "")
          .filter(Boolean)
          .join(" | ");
        return `[Claim ID: ${c.id}] "${c.text}" (Supporting evidence: "${evSnippets}")`;
      })
      .join("\n");

    const prompt = `You are a Scientific Contradiction & Nuance Resolver.
Analyze the following claims for opposing findings, divergent metrics, or apparent contradictions.

Claims:
${claimsContext}

Instructions:
1. Identify any pair of claims that appear contradictory (e.g. one reports speedup, another reports degradation).
2. Determine if the divergence is explained by conditions (e.g. different workloads, tail latency vs throughput, hardware differences) or if it is a genuine contradiction.
3. If an apparent contradiction is conditional, qualify each claim by adding the condition to its limitations.

Respond strictly in valid JSON adhering to:
{
  "contradictions": [
    {
      "claimA": "claim_1",
      "claimB": "claim_2",
      "divergenceReason": "different_metrics",
      "resolution": "Claim 1 measures overall throughput under high batch load, while Claim 2 measures P99 latency with short sequences."
    }
  ],
  "qualifications": {
    "claim_1": ["Performance holds primarily under variable length high concurrency workloads"],
    "claim_2": ["Tail latency degradation occurs when requests saturate GPU memory limits"]
  }
}`;

    const completion = await this.openai!.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: "system", content: "You analyze nuance and empirical discrepancies across scientific evidence. Respond with pure JSON." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");
    const rawContradictions = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
    const qualifications: Record<string, string[]> = parsed.qualifications || {};

    const detectedContradictions: ContradictionReport[] = rawContradictions.map((c: any) => ({
      conflictingClaimIds: [c.claimA, c.claimB],
      topic: "Empirical Divergence",
      divergenceReason: ["different_metrics", "different_workloads", "hardware_difference", "direct_contradiction"].includes(c.divergenceReason)
        ? c.divergenceReason
        : "different_workloads",
      resolution: c.resolution || "Findings depend on distinct experimental parameters.",
    }));

    // Update claim limitations with qualifications
    const resolvedClaims = claims.map((claim) => {
      const addedLimitations = qualifications[claim.id] || [];
      const currentLimitations = claim.limitations || [];
      const combined = Array.from(new Set([...currentLimitations, ...addedLimitations]));

      return {
        ...claim,
        limitations: combined,
        verificationStatus:
          detectedContradictions.some((dc) => dc.conflictingClaimIds.includes(claim.id) && dc.divergenceReason === "direct_contradiction")
            ? ("conflicting" as const)
            : claim.verificationStatus,
      };
    });

    return { resolvedClaims, detectedContradictions };
  }

  private resolveRuleBased(claims: ReportClaim[]): {
    resolvedClaims: ReportClaim[];
    detectedContradictions: ContradictionReport[];
  } {
    const detected: ContradictionReport[] = [];
    const opposingPairs: [string, string][] = [
      ["faster", "slower"],
      ["improves", "degrades"],
      ["increases throughput", "reduces throughput"],
      ["lower latency", "higher latency"],
    ];

    for (let i = 0; i < claims.length; i++) {
      for (let j = i + 1; j < claims.length; j++) {
        const t1 = claims[i]!.text.toLowerCase();
        const t2 = claims[j]!.text.toLowerCase();

        for (const [pos, neg] of opposingPairs) {
          if ((t1.includes(pos!) && t2.includes(neg!)) || (t1.includes(neg!) && t2.includes(pos!))) {
            detected.push({
              conflictingClaimIds: [claims[i]!.id, claims[j]!.id],
              topic: "Contrasting Performance Observations",
              divergenceReason: "different_workloads",
              resolution: `Claim ${claims[i]!.id} and Claim ${claims[j]!.id} report opposing performance trends. Differences often depend on baseline setup and concurrency load.`,
            });
          }
        }
      }
    }

    return { resolvedClaims: claims, detectedContradictions: detected };
  }
}

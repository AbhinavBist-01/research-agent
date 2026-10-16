import OpenAI from "openai";
import type { ReportClaim, Evidence, Source } from "../types.js";
import type { SourceRegistry } from "./source-registry.js";
import { ContradictionResolver, type ContradictionReport } from "./contradiction-resolver.js";

export interface ClaimVerificationResult {
  claimId: string;
  claimText: string;
  passedLevels: {
    level1_exists: boolean;
    level2_retrievable: boolean;
    level3_grounded: boolean;
    level4_entailed: boolean;
    level5_sufficient: boolean;
  };
  overallStatus: "supported" | "partially_supported" | "unsupported" | "conflicting";
  issues: string[];
  entailmentExplanation?: string | undefined;
}

export interface VerificationPipelineResult {
  totalClaimsAudited: number;
  supportedClaimsCount: number;
  partiallySupportedCount: number;
  unsupportedClaimsCount: number;
  citationPrecision: number; // supported / total
  verifiedClaims: ReportClaim[];
  auditResults: ClaimVerificationResult[];
  contradictions: ContradictionReport[];
}

export class CitationVerifier {
  private openai: OpenAI | null = null;
  private modelName: string;
  private contradictionResolver: ContradictionResolver;

  constructor(apiKey?: string, modelName?: string) {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    }
    this.modelName = modelName || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.contradictionResolver = new ContradictionResolver(key, this.modelName);
  }

  /**
   * Executes the 5-Level Citation Validation Pipeline on a list of claims
   */
  async verifyReportClaims(
    claims: ReportClaim[],
    evidenceList: Evidence[],
    sourceRegistry: SourceRegistry
  ): Promise<VerificationPipelineResult> {
    console.log(`[CitationVerifier] 🛡️ Starting 5-Level Verification on ${claims.length} claims...`);

    const evidenceMap = new Map<string, Evidence>(evidenceList.map((e) => [e.id, e]));
    const auditResults: ClaimVerificationResult[] = [];

    for (const claim of claims) {
      const audit = await this.verifySingleClaim(claim, evidenceMap, sourceRegistry);
      auditResults.push(audit);
    }

    // Level 5: Contradiction Resolution & Nuance Handling
    const { resolvedClaims, detectedContradictions } = await this.contradictionResolver.resolveContradictions(
      claims.map((c) => {
        const audit = auditResults.find((a) => a.claimId === c.id);
        return {
          ...c,
          verificationStatus: audit?.overallStatus || c.verificationStatus,
          limitations: Array.from(new Set([...(c.limitations || []), ...(audit?.issues || [])])),
        };
      }),
      evidenceMap
    );

    const supportedCount = resolvedClaims.filter((c) => c.verificationStatus === "supported").length;
    const partialCount = resolvedClaims.filter((c) => c.verificationStatus === "partially_supported").length;
    const unsupportedCount = resolvedClaims.filter((c) => c.verificationStatus === "unsupported").length;
    const precision = claims.length > 0 ? (supportedCount + partialCount * 0.5) / claims.length : 0;

    console.log(`[CitationVerifier] Audit complete: ${supportedCount} supported, ${partialCount} partial, ${unsupportedCount} unsupported. Precision: ${(precision * 100).toFixed(1)}%`);

    return {
      totalClaimsAudited: claims.length,
      supportedClaimsCount: supportedCount,
      partiallySupportedCount: partialCount,
      unsupportedClaimsCount: unsupportedCount,
      citationPrecision: precision,
      verifiedClaims: resolvedClaims,
      auditResults,
      contradictions: detectedContradictions,
    };
  }

  private async verifySingleClaim(
    claim: ReportClaim,
    evidenceMap: Map<string, Evidence>,
    sourceRegistry: SourceRegistry
  ): Promise<ClaimVerificationResult> {
    const issues: string[] = [];
    const passed = {
      level1_exists: true,
      level2_retrievable: true,
      level3_grounded: true,
      level4_entailed: true,
      level5_sufficient: true,
    };

    // LEVEL 1: Citation Identifier Exists
    if (!claim.evidenceIds || claim.evidenceIds.length === 0) {
      passed.level1_exists = false;
      issues.push("Level 1 Failure: Claim has no linked citation evidence IDs.");
      return this.concludeAudit(claim, passed, issues, "unsupported");
    }

    const linkedEvidence: Evidence[] = [];
    for (const evId of claim.evidenceIds) {
      const ev = evidenceMap.get(evId);
      if (!ev) {
        passed.level1_exists = false;
        issues.push(`Level 1 Failure: Evidence ID '${evId}' does not exist in EvidenceStore.`);
      } else {
        linkedEvidence.push(ev);
      }
    }

    if (!passed.level1_exists || linkedEvidence.length === 0) {
      return this.concludeAudit(claim, passed, issues, "unsupported");
    }

    // LEVEL 2: Source Retrievable & Uncorrupted
    for (const ev of linkedEvidence) {
      const source = sourceRegistry.get(ev.sourceId);
      if (!source || source.fetchStatus !== "success") {
        passed.level2_retrievable = false;
        issues.push(`Level 2 Failure: Source '${ev.sourceId}' was blocked or could not be verified.`);
      }
    }

    // LEVEL 3: Text Grounding (Excerpt actually occurs in source)
    for (const ev of linkedEvidence) {
      const grounding = sourceRegistry.verifyGrounding(ev.sourceId, ev.excerpt);
      if (!grounding.grounded) {
        passed.level3_grounded = false;
        issues.push(`Level 3 Failure: Excerpt for Evidence '${ev.id}' not found in captured source content.`);
      }
    }

    if (!passed.level3_grounded) {
      return this.concludeAudit(claim, passed, issues, "unsupported");
    }

    // LEVEL 4: Logical Entailment (Premise -> Hypothesis check)
    const combinedPremise = linkedEvidence.map((e) => e.excerpt).join(" ");
    const entailment = await this.checkEntailment(combinedPremise, claim.text);

    if (!entailment.entailed) {
      passed.level4_entailed = false;
      issues.push(`Level 4 Failure: ${entailment.reason}`);
      return this.concludeAudit(claim, passed, issues, entailment.partiallySupported ? "partially_supported" : "unsupported", entailment.reason);
    }

    // LEVEL 5: Evidence Sufficiency Check
    if (linkedEvidence.length < 1) {
      passed.level5_sufficient = false;
      issues.push("Level 5 Failure: Claim lacks sufficient independent evidence corroboration.");
      return this.concludeAudit(claim, passed, issues, "partially_supported");
    }

    return this.concludeAudit(claim, passed, issues, "supported", entailment.reason);
  }

  /**
   * Evaluates if Premise logically entails Hypothesis (checks for exaggeration or hallucinated universals)
   */
  private async checkEntailment(
    premise: string,
    hypothesis: string
  ): Promise<{ entailed: boolean; partiallySupported?: boolean; reason?: string }> {
    // 1. LLM Entailment Judge if OpenAI client is available
    if (this.openai) {
      try {
        const prompt = `You are a strict Entailment & Factuality Judge in an academic research verifier.
Evaluate whether the Premise logically entails or reasonably supports the Hypothesis.

Premise (Verbatim Source Excerpt):
"${premise}"

Hypothesis (Report's Factual Claim):
"${hypothesis}"

Evaluation Rules:
- If Hypothesis makes an absolute claim ("always", "on every", "100%", "doubles on all") but Premise is conditional, flag as NOT entailed.
- If Hypothesis invents specific numbers or speedups not in the Premise, flag as NOT entailed.
- If Premise directly supports the core statement, flag as entailed.

Respond strictly in valid JSON:
{
  "entailed": true/false,
  "partiallySupported": true/false,
  "reason": "Brief explanation of whether Premise supports Hypothesis."
}`;

        const res = await this.openai.chat.completions.create({
          model: this.modelName,
          messages: [
            { role: "system", content: "You are a logical entailment judge. Always respond with pure JSON." },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.0,
        });

        const parsed = JSON.parse(res.choices[0]?.message.content || "{}");
        return {
          entailed: Boolean(parsed.entailed),
          partiallySupported: Boolean(parsed.partiallySupported),
          reason: parsed.reason || "Evaluated by Entailment Judge",
        };
      } catch (err: any) {
        console.warn(`[CitationVerifier] LLM judge failed (${err.message}). Using deterministic entailment.`);
      }
    }

    // 2. Deterministic Entailment Heuristics (Exaggeration Detector)
    const pLower = premise.toLowerCase();
    const hLower = hypothesis.toLowerCase();

    // Check for unwarranted universal qualifiers
    const universalTerms = ["always", "on every hardware", "universally", "guarantees 100%"];
    for (const term of universalTerms) {
      if (hLower.includes(term) && !pLower.includes(term)) {
        return {
          entailed: false,
          partiallySupported: true,
          reason: `Hypothesis introduces universal claim ('${term}') not substantiated in source excerpt.`,
        };
      }
    }

    // Check keyword overlap
    const hWords = hLower.split(/\W+/).filter((w) => w.length > 3);
    const overlap = hWords.filter((w) => pLower.includes(w));
    const overlapRatio = hWords.length > 0 ? overlap.length / hWords.length : 1;

    if (overlapRatio < 0.3) {
      return {
        entailed: false,
        partiallySupported: false,
        reason: `Hypothesis has low lexical entailment overlap (${Math.round(overlapRatio * 100)}%) with premise.`,
      };
    }

    return {
      entailed: true,
      reason: "Substantiated by source text",
    };
  }

  private concludeAudit(
    claim: ReportClaim,
    passedLevels: ClaimVerificationResult["passedLevels"],
    issues: string[],
    status: ClaimVerificationResult["overallStatus"],
    entailmentExplanation?: string
  ): ClaimVerificationResult {
    return {
      claimId: claim.id,
      claimText: claim.text,
      passedLevels,
      overallStatus: status,
      issues,
      entailmentExplanation,
    };
  }
}

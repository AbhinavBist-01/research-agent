import OpenAI from "openai";
import type { EvidenceStore } from "./evidence-store.js";
import type { ResearchReport, ReportClaim } from "../types.js";

export class Synthesizer {
  private openai: OpenAI | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName: string = "gpt-4o-mini") {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (key) {
      this.openai = new OpenAI({ apiKey: key });
    }
    this.modelName = modelName;
  }

  /**
   * Generates a grounded research report using Claim-First Synthesis
   */
  async synthesize(jobId: string, topic: string, store: EvidenceStore): Promise<ResearchReport> {
    const allEvidence = store.getAllEvidence();
    const allSources = store.getAllSources();

    if (allEvidence.length === 0) {
      return {
        jobId,
        topic,
        summary: "No evidence could be gathered for this research topic.",
        claims: [],
        evidence: [],
        sources: allSources,
        markdown: `# Research Report: ${topic}\n\n**Status:** Incomplete\n\nNo evidence could be extracted from sources.`,
        createdAt: new Date().toISOString(),
      };
    }

    // If OpenAI is available, generate structured claims via LLM
    if (this.openai) {
      try {
        const claims = await this.synthesizeWithLLM(topic, allEvidence);
        const markdown = this.renderMarkdown(topic, claims, store);

        return {
          jobId,
          topic,
          summary: claims.summary,
          claims: claims.claims,
          evidence: allEvidence,
          sources: allSources,
          markdown,
          createdAt: new Date().toISOString(),
        };
      } catch (err: any) {
        console.warn("[Synthesizer] LLM synthesis failed, falling back to deterministic synthesis:", err.message);
      }
    }

    // Deterministic fallback synthesis without LLM
    return this.synthesizeDeterministic(jobId, topic, store);
  }

  private async synthesizeWithLLM(
    topic: string,
    evidence: ReturnType<EvidenceStore["getAllEvidence"]>
  ): Promise<{ summary: string; claims: ReportClaim[] }> {
    const evidenceContext = evidence
      .map(
        (ev) =>
          `[Evidence ID: ${ev.id}] (Source: "${ev.sourceTitle}" <${ev.sourceUrl}>)\nClaim: ${ev.claim}\nExcerpt: "${ev.excerpt}"`
      )
      .join("\n\n");

    const prompt = `You are an expert technical synthesizer.
Your task is to synthesize findings on the topic: "${topic}" using ONLY the provided evidence.

CRITICAL RULES:
1. Do not invent any claims or statistics not supported by the evidence excerpts.
2. Link every single claim to one or more [Evidence ID]s.
3. If an evidence item mentions trade-offs or limitations, preserve them explicitly.

Provided Evidence:
${evidenceContext}

Respond with valid JSON adhering to this schema:
{
  "summary": "2-3 sentence executive summary of the findings",
  "claims": [
    {
      "id": "claim_1",
      "text": "Detailed statement of the factual point.",
      "evidenceIds": ["ev_1", "ev_2"],
      "verificationStatus": "supported",
      "limitations": ["Any qualifications, e.g. depends on workload variance"]
    }
  ]
}`;

    const completion = await this.openai!.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: "system", content: "You are a research synthesis engine that maps factual claims strictly to evidence IDs. Always respond with pure JSON." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const parsed = JSON.parse(completion.choices[0]?.message.content || "{}");
    return {
      summary: parsed.summary || "Summary of findings",
      claims: (parsed.claims || []).map((c: any, idx: number) => ({
        id: c.id || `claim_${idx + 1}`,
        text: c.text,
        evidenceIds: Array.isArray(c.evidenceIds) ? c.evidenceIds : [],
        verificationStatus: c.verificationStatus || "supported",
        limitations: c.limitations || [],
      })),
    };
  }

  private synthesizeDeterministic(jobId: string, topic: string, store: EvidenceStore): ResearchReport {
    const evidenceList = store.getAllEvidence();
    const sourcesList = store.getAllSources();

    const claims: ReportClaim[] = evidenceList.map((ev, index) => ({
      id: `claim_${index + 1}`,
      text: ev.claim,
      evidenceIds: [ev.id],
      verificationStatus: "supported",
      limitations: [],
    }));

    const summary = `Research on "${topic}" established ${claims.length} core findings derived from ${sourcesList.length} verified technical sources.`;
    const markdown = this.renderMarkdown(topic, { summary, claims }, store);

    return {
      jobId,
      topic,
      summary,
      claims,
      evidence: evidenceList,
      sources: sourcesList,
      markdown,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Renders Markdown report with numbered citation links [1], [2]
   */
  private renderMarkdown(topic: string, data: { summary: string; claims: ReportClaim[] }, store: EvidenceStore): string {
    const lines: string[] = [];
    lines.push(`# Research Report: ${topic}`);
    lines.push("");
    lines.push(`**Generated:** ${new Date().toUTCString()}  `);
    lines.push(`**Methodology:** Grounded Claim-First Multi-Source Synthesis`);
    lines.push("");
    lines.push("## Executive Summary");
    lines.push(data.summary);
    lines.push("");
    lines.push("## Key Findings & Grounded Claims");

    // Map each source to a citation index [1], [2]...
    const sourceMap = new Map<string, number>();
    const citationSources: { index: number; id: string; url: string; title: string }[] = [];

    const getCitationNumber = (sourceId: string): number => {
      if (sourceMap.has(sourceId)) {
        return sourceMap.get(sourceId)!;
      }
      const num = citationSources.length + 1;
      sourceMap.set(sourceId, num);
      const source = store.getSource(sourceId);
      citationSources.push({
        index: num,
        id: sourceId,
        url: source?.url || "",
        title: source?.title || "Unknown Source",
      });
      return num;
    };

    for (const claim of data.claims) {
      // Find sources referenced by this claim's evidence
      const sourceNums = new Set<number>();
      for (const evId of claim.evidenceIds) {
        const ev = store.getEvidence(evId);
        if (ev && ev.sourceId) {
          sourceNums.add(getCitationNumber(ev.sourceId));
        }
      }

      const citationMarkers = Array.from(sourceNums)
        .sort((a, b) => a - b)
        .map((n) => `[${n}]`)
        .join(" ");

      lines.push(`- **${claim.text}** ${citationMarkers}`);

      if (claim.limitations && claim.limitations.length > 0) {
        lines.push(`  - *Limitations/Conditions:* ${claim.limitations.join("; ")}`);
      }
    }

    lines.push("");
    lines.push("## Sources & Citation Registry");
    for (const src of citationSources) {
      lines.push(`[${src.index}] **${src.title}**  \n    URL: ${src.url}`);
    }

    return lines.join("\n");
  }
}

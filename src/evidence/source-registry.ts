import * as crypto from "node:crypto";
import type { Source } from "../types.js";

export interface RegisterSourceInput {
  id?: string | undefined;
  url: string;
  title: string;
  content: string;
  canonicalUrl?: string | undefined;
  publisher?: string | undefined;
}

export class SourceRegistry {
  private sources = new Map<string, Source>();
  private urlToId = new Map<string, string>();
  private hashToId = new Map<string, string>();
  private counter = 0;

  /**
   * Registers a new source or returns existing deduplicated source
   */
  register(input: RegisterSourceInput): Source {
    if (input.id && this.sources.has(input.id)) {
      return this.sources.get(input.id)!;
    }

    const canonical = input.canonicalUrl || this.normalizeUrl(input.url);
    const contentHash = crypto.createHash("sha256").update(input.content).digest("hex");

    // Deduplicate by canonical URL
    if (this.urlToId.has(canonical)) {
      const existing = this.sources.get(this.urlToId.get(canonical)!)!;
      if (input.id) {
        this.sources.set(input.id, existing);
      }
      return existing;
    }

    // Deduplicate by content hash
    if (this.hashToId.has(contentHash)) {
      const existing = this.sources.get(this.hashToId.get(contentHash)!)!;
      if (input.id) {
        this.sources.set(input.id, existing);
      }
      return existing;
    }

    this.counter++;
    const id = input.id || `src_${this.counter}`;

    const source: Source = {
      id,
      url: input.url,
      canonicalUrl: canonical,
      title: input.title || input.url,
      retrievedAt: new Date().toISOString(),
      contentHash,
      content: input.content,
      fetchStatus: "success",
    };

    this.sources.set(id, source);
    this.urlToId.set(canonical, id);
    this.hashToId.set(contentHash, id);

    return source;
  }

  get(id: string): Source | undefined {
    return this.sources.get(id);
  }

  getByUrl(url: string): Source | undefined {
    const canonical = this.normalizeUrl(url);
    const id = this.urlToId.get(canonical);
    return id ? this.sources.get(id) : undefined;
  }

  getAll(): Source[] {
    return Array.from(this.sources.values());
  }

  /**
   * Level 3 Grounding Check:
   * Verifies whether an excerpt actually occurs within the captured source content
   */
  verifyGrounding(sourceId: string, excerpt: string): { grounded: boolean; confidence: number; offset?: number } {
    const source = this.sources.get(sourceId);
    if (!source || !source.content) {
      return { grounded: false, confidence: 0 };
    }

    const cleanContent = source.content.toLowerCase().replace(/\s+/g, " ");
    const cleanExcerpt = excerpt.toLowerCase().replace(/\s+/g, " ").trim();

    if (!cleanExcerpt) {
      return { grounded: false, confidence: 0 };
    }

    // Exact normalized substring match
    const idx = cleanContent.indexOf(cleanExcerpt);
    if (idx !== -1) {
      return { grounded: true, confidence: 1.0, offset: idx };
    }

    // Fallback: Check if substantial chunks (at least 75% of words) occur in order
    const words = cleanExcerpt.split(" ");
    if (words.length >= 6) {
      const windowSize = Math.floor(words.length * 0.75);
      const subPhrase = words.slice(0, windowSize).join(" ");
      const subIdx = cleanContent.indexOf(subPhrase);
      if (subIdx !== -1) {
        return { grounded: true, confidence: 0.85, offset: subIdx };
      }
    }

    return { grounded: false, confidence: 0 };
  }

  private normalizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      parsed.hash = "";
      // Strip common analytics query parameters
      parsed.searchParams.delete("utm_source");
      parsed.searchParams.delete("utm_medium");
      parsed.searchParams.delete("utm_campaign");
      parsed.searchParams.delete("ref");
      return parsed.toString().toLowerCase();
    } catch {
      return rawUrl.toLowerCase();
    }
  }
}

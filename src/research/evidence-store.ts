import type { Source, Evidence } from "../types.js";

export class EvidenceStore {
  private sources = new Map<string, Source>();
  private sourcesByHash = new Map<string, string>(); // contentHash -> sourceId
  private sourcesByUrl = new Map<string, string>(); // url -> sourceId
  private evidence = new Map<string, Evidence>();
  private sourceCounter = 0;
  private evidenceCounter = 0;

  /**
   * Adds or deduplicates a source
   */
  addSource(rawSource: Omit<Source, "id">): Source {
    // Check if source already exists by canonical URL or content hash
    if (this.sourcesByUrl.has(rawSource.url)) {
      const existingId = this.sourcesByUrl.get(rawSource.url)!;
      return this.sources.get(existingId)!;
    }

    if (rawSource.contentHash && this.sourcesByHash.has(rawSource.contentHash)) {
      const existingId = this.sourcesByHash.get(rawSource.contentHash)!;
      return this.sources.get(existingId)!;
    }

    this.sourceCounter++;
    const id = `src_${this.sourceCounter}`;
    const source: Source = {
      ...rawSource,
      id,
    };

    this.sources.set(id, source);
    this.sourcesByUrl.set(source.url, id);
    if (source.contentHash) {
      this.sourcesByHash.set(source.contentHash, id);
    }

    return source;
  }

  /**
   * Adds a structured piece of evidence linked to a source
   */
  addEvidence(raw: Omit<Evidence, "id">): Evidence {
    this.evidenceCounter++;
    const id = `ev_${this.evidenceCounter}`;
    const item: Evidence = {
      ...raw,
      id,
    };

    this.evidence.set(id, item);
    return item;
  }

  getSource(id: string): Source | undefined {
    return this.sources.get(id);
  }

  getEvidence(id: string): Evidence | undefined {
    return this.evidence.get(id);
  }

  getAllSources(): Source[] {
    return Array.from(this.sources.values());
  }

  getAllEvidence(): Evidence[] {
    return Array.from(this.evidence.values());
  }

  getEvidenceBySourceId(sourceId: string): Evidence[] {
    return Array.from(this.evidence.values()).filter((e) => e.sourceId === sourceId);
  }

  clear(): void {
    this.sources.clear();
    this.sourcesByHash.clear();
    this.sourcesByUrl.clear();
    this.evidence.clear();
    this.sourceCounter = 0;
    this.evidenceCounter = 0;
  }
}

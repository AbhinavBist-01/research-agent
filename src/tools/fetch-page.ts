import { z } from "zod";
import * as crypto from "node:crypto";
import type { ToolDefinition } from "../types.js";

const FetchPageInputSchema = z.object({
  url: z.string().url().describe("The HTTP or HTTPS URL of the webpage or technical document to retrieve"),
  maxCharacters: z.number().optional().default(8000).describe("Maximum character count of the cleaned text to return (default 8000)"),
});

/**
 * Validates whether a URL is safe against SSRF attacks
 */
export function isSafeUrl(rawUrl: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { safe: false, reason: `Unsupported protocol: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Loopback / localhost checks
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    ) {
      return { safe: false, reason: "Access to localhost/loopback addresses is forbidden (SSRF protection)" };
    }

    // Cloud metadata endpoint
    if (hostname === "169.254.169.254") {
      return { safe: false, reason: "Access to cloud metadata endpoints is forbidden" };
    }

    // Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    if (match) {
      const b0 = parseInt(match[1]!, 10);
      const b1 = parseInt(match[2]!, 10);

      if (b0 === 10) return { safe: false, reason: "Access to private IP range (10.0.0.0/8) is forbidden" };
      if (b0 === 172 && b1 >= 16 && b1 <= 31) return { safe: false, reason: "Access to private IP range (172.16.0.0/12) is forbidden" };
      if (b0 === 192 && b1 === 168) return { safe: false, reason: "Access to private IP range (192.168.0.0/16) is forbidden" };
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, reason: `Malformed URL: ${err.message}` };
  }
}

/**
 * Strips script tags, styles, navbars, and extracts readable textual content
 */
export function cleanHtml(html: string): string {
  // Remove scripts, styles, svgs, iframes
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");
  text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ");
  text = text.replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ");
  text = text.replace(/<(nav|header|footer)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi, " ");

  // Convert headings and paragraphs into newlines
  text = text.replace(/<\/(h[1-6]|p|div|li|tr)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse multiple spaces and blank lines
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n+/g, "\n\n");

  return text.trim();
}

export function createFetchPageTool(): ToolDefinition<
  z.infer<typeof FetchPageInputSchema>,
  { url: string; title: string; contentHash: string; text: string; length: number }
> {
  return {
    name: "fetch_page",
    description: "Fetch and extract clean readable text from a URL with SSRF protection, timeout safeguards, and HTML cleaning.",
    schema: FetchPageInputSchema,
    async execute(input) {
      const safetyCheck = isSafeUrl(input.url);
      if (!safetyCheck.safe) {
        throw new Error(`SSRF Security Error: ${safetyCheck.reason}`);
      }

      const controller = new AbortController();
      const timeoutMs = 8000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(input.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "ResearchAgentBot/1.0 (+https://github.com/ai-cohort/research-agent)",
            Accept: "text/html,application/xhtml+xml,text/plain",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
        }

        const rawHtml = await response.text();
        const cleanedText = cleanHtml(rawHtml);

        // Derive title from raw HTML if possible
        const titleMatch = rawHtml.match(/<title[^>]*>(.*?)<\/title>/i);
        const title = titleMatch && titleMatch[1] ? titleMatch[1].trim() : input.url;

        // Content hash for deduplication
        const contentHash = crypto.createHash("sha256").update(cleanedText).digest("hex");

        const maxChars = input.maxCharacters || 8000;
        const truncated = cleanedText.length > maxChars ? cleanedText.slice(0, maxChars) + "\n...[Content Truncated]" : cleanedText;

        return {
          url: input.url,
          title,
          contentHash,
          text: truncated,
          length: truncated.length,
        };
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          throw new Error(`Request timed out after ${timeoutMs}ms when fetching ${input.url}`);
        }
        throw err;
      }
    },
  };
}

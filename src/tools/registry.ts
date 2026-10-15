import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any, any>>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: "${name}". Available tools: ${Array.from(this.tools.keys()).join(", ")}`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Returns tool schemas formatted for OpenAI / LLM function calling
   */
  getOpenAITools() {
    return Array.from(this.tools.values()).map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.schema) as Record<string, any>;
      // Strip meta-schema field if present for clean API consumption
      const { $schema, ...cleanSchema } = jsonSchema;
      return {
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: cleanSchema,
        },
      };
    });
  }

  /**
   * Safely execute a tool with input schema validation
   */
  async execute(name: string, rawInput: unknown, context?: ToolContext): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const tool = this.get(name);
      // Validate schema
      const validatedInput = tool.schema.parse(rawInput);
      const data = await tool.execute(validatedInput, context);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
      };
    }
  }
}

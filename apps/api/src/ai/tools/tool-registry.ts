import { Injectable } from '@nestjs/common';
import type { AgentTool } from './agent-tool.interface';

@Injectable()
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  getAvailableTools(enabledNames?: string[]): AgentTool[] {
    const all = [...this.tools.values()];
    if (!enabledNames) return all;
    const enabled = new Set(enabledNames);
    return all.filter((tool) => enabled.has(tool.name));
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }
}

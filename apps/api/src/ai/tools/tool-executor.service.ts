import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { sanitizeToolResult } from '../../common/utils/sanitize';
import { withTimeout } from '../../common/utils/timeout';
import { withExponentialBackoff } from '../../common/utils/retry';
import type { ToolContext, ToolResult } from './agent-tool.interface';
import { ToolRegistry } from './tool-registry';

@Injectable()
export class ToolExecutorService {
  private readonly logger = new Logger(ToolExecutorService.name);
  private readonly timeoutMs = 12_000;

  constructor(
    private readonly registry: ToolRegistry,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async execute(
    toolName: string,
    rawInput: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolName);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }

    if (!context.enabledTools.includes(toolName)) {
      return {
        success: false,
        error: `Tool "${toolName}" is not enabled for this agent`,
      };
    }

    const config = await this.prisma.toolConfig.findUnique({
      where: {
        businessId_name: { businessId: context.businessId, name: toolName },
      },
    });

    if (config && !config.enabled) {
      return { success: false, error: `Tool "${toolName}" is disabled` };
    }

    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: 'Invalid tool arguments',
        data: parsed.error.flatten(),
      };
    }

    const risk = config?.risk ?? tool.risk;
    if (
      (risk === 'SENSITIVE' || config?.requireConfirmation) &&
      context.metadata?.confirmed !== true
    ) {
      return {
        success: false,
        requiresConfirmation: true,
        error: 'This action requires confirmation before execution',
      };
    }

    const idempotencyKey =
      context.idempotencyKey ??
      this.buildIdempotencyKey(toolName, parsed.data, context);

    if (risk !== 'READ') {
      const lockKey = `idempotency:${context.businessId}:${idempotencyKey}`;
      const acquired = await this.redis.acquireLock(lockKey, 60 * 30);
      if (!acquired) {
        return {
          success: false,
          error: 'Duplicate operation blocked by idempotency key',
        };
      }
    }

    const started = Date.now();
    try {
      const run = () => tool.execute(parsed.data, { ...context, idempotencyKey });
      const result =
        risk === 'READ'
          ? await withExponentialBackoff(() =>
              withTimeout(run, this.timeoutMs, toolName),
            )
          : await withTimeout(run, this.timeoutMs, toolName);

      const sanitized: ToolResult = {
        ...result,
        data: result.data ? sanitizeToolResult(result.data) : undefined,
        durationMs: Date.now() - started,
      };

      await this.record(toolName, parsed.data, sanitized, context, sanitized.durationMs ?? 0);
      return sanitized;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool failed';
      this.logger.warn(`Tool ${toolName} failed: ${message}`);
      const failed: ToolResult = {
        success: false,
        error: message,
        durationMs: Date.now() - started,
      };
      await this.record(toolName, parsed.data, failed, context, failed.durationMs ?? 0);
      return failed;
    }
  }

  private buildIdempotencyKey(
    toolName: string,
    input: unknown,
    context: ToolContext,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          toolName,
          input,
          businessId: context.businessId,
          conversationId: context.conversationId,
        }),
      )
      .digest('hex')
      .slice(0, 48);
  }

  private async record(
    toolName: string,
    input: unknown,
    result: ToolResult,
    context: ToolContext,
    durationMs: number,
  ): Promise<void> {
    await this.prisma.toolExecution.create({
      data: {
        agentExecutionId: context.agentExecutionId,
        businessId: context.businessId,
        conversationId: context.conversationId,
        tool: toolName,
        input: input as object,
        output: result as object,
        durationMs,
        success: result.success,
        error: result.error,
        idempotencyKey: context.idempotencyKey,
      },
    });
  }
}

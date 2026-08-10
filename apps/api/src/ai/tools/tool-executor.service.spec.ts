import { ToolExecutorService } from './tool-executor.service';
import { ToolRegistry } from './tool-registry';
import { z } from 'zod';
import type { AgentTool } from './agent-tool.interface';

describe('ToolExecutorService permissions', () => {
  const registry = new ToolRegistry();
  const readTool: AgentTool = {
    name: 'getOpeningHours',
    description: 'hours',
    schema: z.object({}),
    risk: 'READ',
    execute: jest.fn(async () => ({ success: true, data: { open: true } })),
  };
  registry.register(readTool);

  const prisma = {
    toolConfig: { findUnique: jest.fn() },
    toolExecution: { create: jest.fn().mockResolvedValue({}) },
  };
  const redis = {
    acquireLock: jest.fn().mockResolvedValue(true),
  };
  const executor = new ToolExecutorService(
    registry,
    prisma as never,
    redis as never,
  );

  const baseContext = {
    businessId: 'biz-1',
    conversationId: 'conv-1',
    channel: 'WEB',
    enabledTools: ['getOpeningHours'],
  };

  it('blocks tools that are not enabled for the agent', async () => {
    const result = await executor.execute('getOpeningHours', {}, {
      ...baseContext,
      enabledTools: [],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not enabled/i);
  });

  it('blocks disabled tool configs', async () => {
    prisma.toolConfig.findUnique.mockResolvedValue({
      enabled: false,
      risk: 'READ',
      requireConfirmation: false,
    });
    const result = await executor.execute('getOpeningHours', {}, baseContext);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled/i);
  });

  it('executes an enabled READ tool', async () => {
    prisma.toolConfig.findUnique.mockResolvedValue({
      enabled: true,
      risk: 'READ',
      requireConfirmation: false,
    });
    const result = await executor.execute('getOpeningHours', {}, baseContext);
    expect(result.success).toBe(true);
    expect(readTool.execute).toHaveBeenCalled();
  });

  it('requires confirmation for sensitive tools', async () => {
    const sensitive: AgentTool = {
      name: 'sendEmail',
      description: 'email',
      schema: z.object({ to: z.string().email() }),
      risk: 'SENSITIVE',
      execute: jest.fn(),
    };
    registry.register(sensitive);
    prisma.toolConfig.findUnique.mockResolvedValue({
      enabled: true,
      risk: 'SENSITIVE',
      requireConfirmation: true,
    });

    const result = await executor.execute(
      'sendEmail',
      { to: 'a@test.com' },
      { ...baseContext, enabledTools: ['sendEmail'] },
    );
    expect(result.requiresConfirmation).toBe(true);
    expect(sensitive.execute).not.toHaveBeenCalled();
  });
});

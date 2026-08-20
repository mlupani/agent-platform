import { NotFoundException } from '@nestjs/common';
import { WebChatService } from './web-chat.service';

describe('WebChatService', () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
  const agent = {
    run: jest.fn(),
  };
  const config = {
    touchLastUsed: jest.fn(),
  };

  const service = new WebChatService(
    prisma as never,
    agent as never,
    config as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a WEB conversation and returns the agent reply', async () => {
    prisma.conversation.create.mockResolvedValue({ id: 'conv-1' });
    agent.run.mockResolvedValue({
      conversationId: 'conv-1',
      message: 'Abrimos de 10 a 18',
      status: 'AI',
    });

    const result = await service.handleMessage({
      businessId: 'biz-1',
      message: 'Quiero conocer los horarios',
      source: 'website',
    });

    expect(prisma.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'WEB',
          contactName: 'Visitante web',
        }),
      }),
    );
    expect(agent.run).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'WEB',
        message: 'Quiero conocer los horarios',
      }),
    );
    expect(result).toEqual({
      conversationId: 'conv-1',
      message: 'Abrimos de 10 a 18',
      status: 'AI',
    });
    expect(config.touchLastUsed).toHaveBeenCalledWith('biz-1');
  });

  it('rejects a conversation that is not WEB', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(
      service.handleMessage({
        businessId: 'biz-1',
        conversationId: 'conv-wa',
        message: 'Hola',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(agent.run).not.toHaveBeenCalled();
  });
});

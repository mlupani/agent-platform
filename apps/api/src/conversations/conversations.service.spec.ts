import { ConversationsService } from './conversations.service';

describe('ConversationsService inbox', () => {
  const prisma = {
    conversation: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
  };
  const businesses = {
    getCurrentId: jest.fn().mockResolvedValue('biz-1'),
  };
  const channels = {
    get: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const realtime = {
    conversationMessageCreated: jest.fn(),
    conversationUpdated: jest.fn(),
    conversationBotStatusChanged: jest.fn(),
  };
  const wahaSync = {
    syncChats: jest.fn().mockResolvedValue(0),
    syncMessages: jest.fn().mockResolvedValue(0),
  };
  const service = new ConversationsService(
    prisma as never,
    businesses as never,
    channels as never,
    realtime as never,
    wahaSync as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    businesses.getCurrentId.mockResolvedValue('biz-1');
  });

  it('scopes get() to the current business', async () => {
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.get('conv-1', { role: 'ADMIN' })).rejects.toThrow(
      'Conversation not found',
    );
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1', businessId: 'biz-1' },
      }),
    );
  });

  it('hides playground channels from USER role list', async () => {
    prisma.conversation.findMany.mockResolvedValue([]);
    await service.list(undefined, { role: 'USER' });
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          channel: { notIn: ['PLAYGROUND'] },
        }),
      }),
    );
  });

  it('pauses bot by setting HUMAN status', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      status: 'AI',
      metadata: {},
      channel: 'WHATSAPP',
      hiddenAt: null,
    });
    prisma.conversation.update.mockResolvedValue({
      id: 'conv-1',
      status: 'HUMAN',
    });

    const result = await service.pause('conv-1', { role: 'ADMIN' });
    expect(result.status).toBe('HUMAN');
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'HUMAN' }),
      }),
    );
  });

  it('sends a human message and marks bot as HUMAN', async () => {
    prisma.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
      status: 'AI',
      channel: 'WHATSAPP',
      hiddenAt: null,
    });
    prisma.message.create.mockResolvedValue({
      id: 'msg-1',
      sender: 'HUMAN',
      content: 'Hola, te atiende',
    });
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      businessId: 'biz-1',
    });
    prisma.conversation.update.mockResolvedValue({});

    const message = await service.sendHumanMessage(
      'conv-1',
      'Hola, te atiende',
      { role: 'ADMIN' },
    );
    expect(message.sender).toBe('HUMAN');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sender: 'HUMAN',
          role: 'assistant',
          content: 'Hola, te atiende',
        }),
      }),
    );
    expect(channels.get).toHaveBeenCalledWith('WHATSAPP');
  });
});

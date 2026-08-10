import { CreateLeadTool } from './create-lead.tool';

describe('CreateLeadTool', () => {
  const prisma = {
    lead: { create: jest.fn() },
  };
  const tool = new CreateLeadTool(prisma as never);

  it('creates a lead for the current business', async () => {
    prisma.lead.create.mockResolvedValue({ id: 'lead-1' });

    const result = await tool.execute(
      { name: 'Ana', email: 'ana@test.com', message: 'Quiero info' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'WEB',
        enabledTools: ['createLead'],
      },
    );

    expect(result.success).toBe(true);
    expect(prisma.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'biz-1',
        name: 'Ana',
        email: 'ana@test.com',
      }),
    });
  });

  it('rejects invalid email', async () => {
    await expect(
      tool.execute(
        { email: 'not-an-email' },
        {
          businessId: 'biz-1',
          conversationId: 'conv-1',
          channel: 'WEB',
          enabledTools: ['createLead'],
        },
      ),
    ).rejects.toThrow();
  });
});

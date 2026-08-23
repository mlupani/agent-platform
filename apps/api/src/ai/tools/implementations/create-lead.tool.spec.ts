import { CreateLeadTool } from './create-lead.tool';

describe('CreateLeadTool', () => {
  const leads = {
    capture: jest.fn(),
  };
  const tool = new CreateLeadTool(leads as never);

  it('creates a lead for the current business', async () => {
    leads.capture.mockResolvedValue({ id: 'lead-1' });

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
    expect(result.data).toEqual({ leadId: 'lead-1' });
    expect(leads.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        conversationId: 'conv-1',
        name: 'Ana',
        email: 'ana@test.com',
        source: 'WEB',
      }),
    );
  });

  it('fails when there is no contact data', async () => {
    leads.capture.mockResolvedValue(null);

    const result = await tool.execute(
      { message: 'Quiero info' },
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'WEB',
        enabledTools: ['createLead'],
      },
    );

    expect(result.success).toBe(false);
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

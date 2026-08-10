import { GetServicesTool } from './get-services.tool';

describe('GetServicesTool', () => {
  it('lists enabled services for the business', async () => {
    const prisma = {
      service: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 's1',
            name: 'Consulta',
            description: 'Inicial',
            durationMinutes: 30,
            price: { toString: () => '15000' },
            priceDescription: '$15.000',
            requiresAppointment: true,
            enabled: true,
          },
        ]),
      },
    };
    const tool = new GetServicesTool(prisma as never);
    const result = await tool.execute(
      {},
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'WEB',
        enabledTools: ['getServices'],
      },
    );

    expect(result.success).toBe(true);
    expect(prisma.service.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz-1', enabled: true },
      }),
    );
  });
});

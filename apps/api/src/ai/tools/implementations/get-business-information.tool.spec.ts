import { GetBusinessInformationTool } from './get-business-information.tool';

describe('GetBusinessInformationTool', () => {
  it('returns only the requested business data', async () => {
    const prisma = {
      business: {
        findFirst: jest.fn().mockResolvedValue({
          name: 'Demo Business',
          description: 'Demo',
          type: 'OTHER',
          language: 'es',
          timezone: 'America/Argentina/Buenos_Aires',
          address: 'Av. Ejemplo 123',
          phone: '+54 11 5555-1234',
          whatsapp: '+5491155551234',
          email: 'hola@demo.test',
          website: null,
          instagram: null,
          additionalInfo: null,
          rules: { escalateIfUnsure: true },
        }),
      },
    };
    const tool = new GetBusinessInformationTool(prisma as never);
    const result = await tool.execute(
      {},
      {
        businessId: 'biz-1',
        conversationId: 'conv-1',
        channel: 'WEB',
        enabledTools: ['getBusinessInformation'],
      },
    );

    expect(result.success).toBe(true);
    expect(prisma.business.findFirst).toHaveBeenCalledWith({
      where: { id: 'biz-1' },
      select: expect.any(Object),
    });
  });
});

import { CallsAdminController } from './calls-admin.controller';

describe('CallsAdminController', () => {
  const configService = {
    getPublic: jest.fn(),
    upsert: jest.fn(),
    listPhoneNumbers: jest.fn(),
    syncPhoneNumber: jest.fn(),
  };
  const prisma = { callLog: { findMany: jest.fn() } };
  const businesses = { getCurrentId: jest.fn(async () => 'biz-1') };
  const controller = new CallsAdminController(
    configService as never,
    prisma as never,
    businesses as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('GET /admin/calls devuelve la config pública', async () => {
    configService.getPublic.mockResolvedValue({ enabled: true });
    expect(await controller.get()).toEqual({ enabled: true });
  });

  it('PUT /admin/calls valida y delega en upsert', async () => {
    configService.upsert.mockResolvedValue({ enabled: false });
    const result = await controller.upsert({
      enabled: false,
      transcriberLanguage: '',
    });
    expect(configService.upsert).toHaveBeenCalledWith({
      enabled: false,
      transcriberLanguage: '',
    });
    expect(result).toEqual({ enabled: false });
  });

  it('GET /admin/calls/logs limita y filtra por negocio', async () => {
    prisma.callLog.findMany.mockResolvedValue([{ id: 'c1' }]);
    await controller.logs('5');
    expect(prisma.callLog.findMany).toHaveBeenCalledWith({
      where: { businessId: 'biz-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });
});

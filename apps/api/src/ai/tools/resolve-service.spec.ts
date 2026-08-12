import { resolveServiceId } from './resolve-service';

describe('resolveServiceId', () => {
  const businessId = 'biz-1';

  it('resolves by uuid', async () => {
    const prisma = {
      service: {
        findFirst: jest.fn().mockResolvedValue({
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Consulta inicial',
        }),
      },
    };

    const result = await resolveServiceId(
      prisma as never,
      businessId,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(result?.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(prisma.service.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
  });

  it('resolves by exact name', async () => {
    const prisma = {
      service: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'svc-1',
          name: 'Consulta inicial',
        }),
        findMany: jest.fn(),
      },
    };

    const result = await resolveServiceId(
      prisma as never,
      businessId,
      'Consulta inicial',
    );

    expect(result).toEqual({ id: 'svc-1', name: 'Consulta inicial' });
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });

  it('returns null when name is ambiguous', async () => {
    const prisma = {
      service: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', name: 'Consulta inicial' },
          { id: 'b', name: 'Consulta avanzada' },
        ]),
      },
    };

    const result = await resolveServiceId(
      prisma as never,
      businessId,
      'Consulta',
    );

    expect(result).toBeNull();
  });
});

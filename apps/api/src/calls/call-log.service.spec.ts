import { CallLogService } from './call-log.service';

describe('CallLogService', () => {
  const prisma = {
    callLog: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    conversation: { update: jest.fn() },
  };
  const realtime = { conversationUpdated: jest.fn() };
  const service = new CallLogService(prisma as never, realtime as never);

  beforeEach(() => jest.clearAllMocks());

  it('startInboundCall es idempotente (upsert por vapiCallId)', async () => {
    await service.startInboundCall({
      businessId: 'biz-1', vapiCallId: 'call_1', conversationId: 'conv_1',
      fromNumber: '+549110', toNumber: '+549111',
    });
    const arg = prisma.callLog.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ vapiCallId: 'call_1' });
    expect(arg.create).toMatchObject({
      businessId: 'biz-1', conversationId: 'conv_1', vapiCallId: 'call_1',
      direction: 'inbound', status: 'ringing', fromNumber: '+549110',
    });
  });

  it('updateStatus mapea ended y setea endedAt', async () => {
    await service.updateStatus('call_1', 'ended');
    const arg = prisma.callLog.update.mock.calls[0][0];
    expect(arg.where).toEqual({ vapiCallId: 'call_1' });
    expect(arg.data.status).toBe('ended');
    expect(arg.data.endedAt).toBeInstanceOf(Date);
  });

  it('finalizeFromReport completa el log y cierra la conversación', async () => {
    prisma.callLog.update.mockResolvedValue({
      id: 'cl_1', businessId: 'biz-1', conversationId: 'conv_1', vapiCallId: 'call_1',
    });
    await service.finalizeFromReport({
      vapiCallId: 'call_1',
      endedReason: 'customer-ended-call',
      startedAt: '2026-09-02T10:00:00Z',
      endedAt: '2026-09-02T10:03:00Z',
      costUsd: 0.12,
      transcript: 'hola...',
      summary: 'El cliente pidió un turno.',
    });
    const logArg = prisma.callLog.update.mock.calls[0][0];
    expect(logArg.data).toMatchObject({
      endedReason: 'customer-ended-call', costUsd: 0.12,
      transcript: 'hola...', summary: 'El cliente pidió un turno.', durationSeconds: 180,
    });
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv_1' },
      data: expect.objectContaining({ status: 'CLOSED', summary: 'El cliente pidió un turno.' }),
    });
    expect(realtime.conversationUpdated).toHaveBeenCalledWith('biz-1', expect.objectContaining({ conversationId: 'conv_1' }));
  });

  it('finalizeFromReport tolera call desconocida sin romper', async () => {
    prisma.callLog.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    await expect(service.finalizeFromReport({ vapiCallId: 'ghost' })).resolves.toBeUndefined();
  });
});

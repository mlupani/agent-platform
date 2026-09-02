import { Logger } from '@nestjs/common';
import { CallLogService } from './call-log.service';

describe('CallLogService', () => {
  const prisma = {
    callLog: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
    conversation: { update: jest.fn() },
  };
  const realtime = { conversationUpdated: jest.fn() };
  const service = new CallLogService(prisma as never, realtime as never);

  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

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

  it('finalizeFromReport tolera call desconocida (P2025) sin romper y loguea warn', async () => {
    prisma.callLog.update.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P2025' }));
    await expect(service.finalizeFromReport({ vapiCallId: 'ghost' })).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ghost'));
    expect(errorSpy).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('finalizeFromReport ante un fallo real (no P2025) no re-lanza pero loguea error', async () => {
    prisma.callLog.update.mockRejectedValue(new Error('connection refused'));
    await expect(service.finalizeFromReport({ vapiCallId: 'call_1' })).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(realtime.conversationUpdated).not.toHaveBeenCalled();
  });

  it('updateStatus ante un fallo real (no P2025) no re-lanza pero loguea error', async () => {
    prisma.callLog.update.mockRejectedValue(new Error('connection refused'));
    await expect(service.updateStatus('call_1', 'ended')).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

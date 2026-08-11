import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { ADMIN_SESSION_COOKIE } from '../auth/auth.constants';
import type { RealtimeEnvelope } from './realtime.types';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly env: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async handleConnection(client: Socket) {
    const apiKey =
      (client.handshake.auth?.apiKey as string | undefined) ||
      (client.handshake.query?.apiKey as string | undefined) ||
      (client.handshake.headers['x-api-key'] as string | undefined);
    const expected = this.env.get<string>('ADMIN_API_KEY');

    if (expected && apiKey && apiKey === expected) {
      client.join('admin');
      this.logger.log(`WS connected ${client.id} (api-key)`);
      return;
    }

    const sid = this.readSidFromHandshake(client);
    const session = await this.auth.getSession(sid);
    if (session) {
      client.join('admin');
      this.logger.log(`WS connected ${client.id} (${session.username})`);
      return;
    }

    this.logger.warn(`WS rejected unauthorized client ${client.id}`);
    client.disconnect(true);
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket, @MessageBody() body: unknown) {
    client.emit('pong', body ?? { ok: true });
  }

  broadcast(envelope: RealtimeEnvelope) {
    if (!this.server) return;
    this.server.to('admin').emit(envelope.event, envelope);
    this.server.to('admin').emit('realtime.event', envelope);
  }

  private readSidFromHandshake(client: Socket): string | undefined {
    const cookieHeader = client.handshake.headers.cookie ?? '';
    const match = cookieHeader
      .split(';')
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${ADMIN_SESSION_COOKIE}=`));
    return match?.slice(ADMIN_SESSION_COOKIE.length + 1);
  }
}

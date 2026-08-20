import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  const adminOrigin = process.env.ADMIN_URL ?? 'http://localhost:3000';
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || origin === adminOrigin) {
        callback(null, true);
        return;
      }
      // Widget embebido en landings: refleja el origen. La auth es la API key, no cookies.
      callback(null, true);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
  });
  app.setGlobalPrefix('api');
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
  await app.listen(port);
}

void bootstrap();

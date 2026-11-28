import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { resolveAuthMode } from './auth/auth.guard';

async function bootstrap() {
  const authMode = resolveAuthMode(process.env.AUTH_MODE); // throws (server won't start) rather than running without auth
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // security headers on everything, static files included
  app.disable('x-powered-by');
  app.use((_req: any, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    if (process.env.DATABASE_URL) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  // Mobile web app (no build step) served at /app
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/app', index: 'index.html' });
  // Root conveniences: open the app, and serve icons browsers/iOS request at the domain root.
  const http = app.getHttpAdapter();
  http.get('/', (_req: any, res: any) => res.redirect(302, '/app/'));
  for (const f of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
    http.get(`/${f}`, (_req: any, res: any) => res.sendFile(join(__dirname, '..', 'public', 'apple-touch-icon.png')));
  }
  http.get('/favicon.ico', (_req: any, res: any) => res.redirect(301, '/app/icon.svg'));
  // CORS: the app itself is same-origin; only the AI-connector endpoints (OAuth discovery/registration/token, MCP)
  // are open to other origins. They use bearer tokens, never cookies.
  const OPEN_PATHS = /^\/(\.well-known\/|oauth\/|register$|token$|mcp\b)/;
  app.enableCors((req: any, cb: (e: Error | null, o: object) => void) =>
    cb(null, OPEN_PATHS.test(String(req.path ?? req.url ?? '').split('?')[0]) ? { origin: true } : { origin: false }),
  );
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`StrainEat API on :${port} (auth=${authMode}, db=${process.env.DATABASE_URL ? 'postgres' : 'memory'})`);
}
bootstrap();

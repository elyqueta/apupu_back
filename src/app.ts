import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pool } from './database/pool';
import { env } from './config/env';
import { corsOptions } from './config/cors';
import { swaggerSpec } from './config/swagger';
import { asyncHandler } from './middlewares/asyncHandler';
import { notFoundHandler } from './middlewares/notFoundHandler';
import { errorHandler } from './middlewares/errorHandler';
import { apiLimiter } from './middlewares/rateLimiter';
import { noStore } from './middlewares/noStore';
import { requestId } from './middlewares/requestId';
import { logger } from './config/logger';
import v1Routes from './routes/v1';

const app: Application = express();

app.set('trust proxy', env.TRUST_PROXY);
app.set('etag', 'weak');

app.use(requestId);
app.use(
  helmet({
    // A documentação usa um script inline em desenvolvimento; em
    // produção a documentação não é servida.
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  })
);
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Dados pessoais e links secretos nunca devem ser guardados em caches.
app.use('/api/v1', noStore);

// O limite global aplica-se em todos os ambientes: a superfície de
// ataque (tokens, criação de eventos) existe mesmo em desenvolvimento
// exposto. Endpoints com tokens têm limites adicionais nas rotas.
app.use('/api/v1', apiLimiter);

/**
 * Documentação interativa, disponível apenas fora de produção.
 *
 * O HTML carrega o Scalar UI via CDN; o spec fica em `/openapi.json`.
 */
if (env.NODE_ENV !== 'production') {
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(swaggerSpec);
  });

  app.get('/api-docs', (_req: Request, res: Response) => {
    res.type('html').send(`
      <!doctype html>
      <html>
        <head>
          <title>Apupu API Docs</title>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </head>
        <body>
          <script
            id="api-reference"
            data-url="/openapi.json"
            data-configuration='{"theme":"purple"}'
          ></script>
          <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
        </body>
      </html>
    `);
  });
}

/**
 * Health check.
 *
 * Consulta o banco (`SELECT 1`) para confirmar não só que o processo
 * está de pé, mas que a dependência crítica responde.
 */
app.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');

      res.status(200).json({
        status: 'ok',
        service: 'apupu-backend',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Falha no health check ao consultar o banco.');
      res.status(503).json({
        status: 'error',
        service: 'apupu-backend',
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }
  })
);

/**
 * Rotas de domínio, versionadas em `/api/v1`.
 *
 * O router agregador em `src/routes/v1/index.ts` monta os domínios sem
 * prefixo próprio; uma futura v2 encaixa-se criando `src/routes/v2/`
 * e montando-a aqui, sem tocar na v1.
 */
app.use('/api/v1', v1Routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

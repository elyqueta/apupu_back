import 'dotenv/config';
import express, { Application, NextFunction, Request, Response } from 'express';
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
import { apiLimiter, authIpLimiter } from './middlewares/rateLimiter';
import { noStore } from './middlewares/noStore';
import { publicInviteHeaders } from './middlewares/publicInviteHeaders';
import { requestId } from './middlewares/requestId';
import { logger } from './config/logger';
import {
  configurePassport,
  isGoogleOAuthConfigured,
  typedPassport,
} from './config/passport.config';
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

/**
 * Passport sem sessões: o callback devolve JSON e não cria cookie.
 * A estratégia só é registada quando as variáveis Google estão preenchidas.
 */
configurePassport();
app.use(typedPassport.initialize());

// Respostas de autenticação também não podem ser cacheadas.
app.use('/auth', noStore);

/**
 * Inicia o fluxo OAuth2 do Google.
 *
 * GET /auth/google -> redireciona para o consent screen do Google,
 * pedindo os escopos `profile` e `email`.
 */
app.get('/auth/google', authIpLimiter, (req: Request, res: Response, next: NextFunction) => {
  if (!isGoogleOAuthConfigured()) {
    res.status(503).json({
      error: 'google_oauth_not_configured',
      message: 'Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e CALLBACK_URL no .env.',
    });
    return;
  }

  typedPassport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,
  })(req, res, next);
});

/**
 * Callback do Google.
 *
 * GET /auth/google/callback?code=... -> valida o código, obtém o perfil
 * e devolve os dados do utilizador em JSON (sem sessão/token opaco).
 */
app.get(
  '/auth/google/callback',
  authIpLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    if (!isGoogleOAuthConfigured()) {
      res.status(503).json({
        error: 'google_oauth_not_configured',
        message: 'Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e CALLBACK_URL no .env.',
      });
      return;
    }

    typedPassport.authenticate(
      'google',
      { session: false },
      (err: unknown, user: Express.User | false | undefined, _info: unknown) => {
        if (err) {
          next(err);
          return;
        }

        if (!user) {
          res.status(401).json({
            error: 'google_authentication_failed',
            message: 'O Google não autenticou o utilizador ou o pedido foi cancelado.',
          });
          return;
        }

        // `user` é GoogleProfile (ver src/types/express/index.d.ts).
        res.status(200).json({
          provider: user.provider,
          id: user.id,
          displayName: user.displayName,
          name: user.name,
          emails: user.emails,
          photos: user.photos,
        });
      }
    )(req, res, next);
  }
);

// Dados pessoais e links secretos nunca devem ser guardados em caches.
app.use('/api/v1', noStore);

// Os URLs públicos de convites contêm tokens em claro: não os enviar
// como referrer nem permitir caching das respostas.
app.use('/api/v1/public', publicInviteHeaders);

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
          <title>Conto Contigo API Docs</title>
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
        service: 'conto-contigo-backend',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error({ err: error }, 'Falha no health check ao consultar o banco.');
      res.status(503).json({
        status: 'error',
        service: 'conto-contigo-backend',
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

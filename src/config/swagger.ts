import path from 'node:path';
import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';
import { apupuSchemas } from './swagger-schemas/apupu.schemas';
import { errorResponses, operationErrorResponses } from './swagger-responses';

const swaggerDefinition: swaggerJsdoc.OAS3Definition = {
  openapi: '3.0.0',
  info: {
    title: 'Conta Comigo API',
    version: '0.1.0',
    description:
      'API REST do Conta Comigo — plataforma de convites para eventos. ' +
      'Os anfitriões podem criar conta (email + senha) e gerir eventos no ' +
      'workspace autenticado; o fluxo legado por link secreto continua ' +
      'válido e o aceite público do convite não exige conta. ' +
      'O registo exige verificação do email por código OTP antes da ' +
      'criação da conta. ' +
      'Documentação gerada a partir dos comentários JSDoc das rotas.',
  },
  servers: [
    {
      url: `http://localhost:${env.PORT}`,
      description: 'Servidor local de desenvolvimento',
    },
  ],
  components: {
    schemas: apupuSchemas,
    securitySchemes: {
      hostSession: {
        type: 'apiKey',
        in: 'cookie',
        name: `${env.HOST_COOKIE_NAME}_<eventId>`,
        description:
          'Cookie HttpOnly emitido por POST /host/session. Operações mutáveis exigem também X-CSRF-Token.',
      },
      accountSession: {
        type: 'apiKey',
        in: 'cookie',
        name: env.AUTH_COOKIE_NAME,
        description:
          'Cookie HttpOnly emitido por POST /auth/login. Operações mutáveis exigem também o cabeçalho X-CSRF-Token (valor devolvido no login ou em GET /auth/session).',
      },
    },
    responses: {
      ValidationError: {
        description: 'Dados inválidos.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      ...errorResponses,
    },
  },
};

const options: swaggerJsdoc.Options = {
  definition: swaggerDefinition,
  // Em desenvolvimento (tsx) os ficheiros são .ts; na imagem Docker
  // compilada são .js. Usamos `process.cwd()` em vez de `__dirname`
  // porque `__dirname` não existe de forma fiável quando o projeto é
  // carregado como ESM (Vitest, por exemplo).
  apis: [
    path.join(process.cwd(), 'src/routes/v1/*.routes.ts'),
    path.join(process.cwd(), 'dist/routes/v1/*.routes.js'),
  ],
};

interface GeneratedOperation {
  responses?: Record<string, unknown>;
}

const generated = swaggerJsdoc(options) as unknown as {
  paths?: Record<string, Record<string, unknown>>;
};

/**
 * Completa as respostas de erro de cada operação.
 *
 * As anotações JSDoc descrevem o caso concreto de cada rota; o corpo
 * JSON vem do mapa central, para que a documentação interativa mostre
 * sempre o envelope `error` completo. A descrição da rota é preservada
 * e usada em vez da descrição genérica do componente.
 */
for (const [pathName, pathItem] of Object.entries(generated.paths ?? {})) {
  for (const [method, rawOperation] of Object.entries(pathItem)) {
    const mapping = operationErrorResponses[`${method.toLowerCase()} ${pathName}`];

    if (!mapping) continue;

    const operation = rawOperation as GeneratedOperation;
    operation.responses ??= {};

    for (const [status, responseName] of Object.entries(mapping)) {
      if (!responseName) continue;

      const response = errorResponses[responseName];
      const existing = operation.responses[status] as
        | { description?: string }
        | undefined;

      operation.responses[status] = {
        description: existing?.description ?? response.description,
        content: response.content,
      };
    }
  }
}

export const swaggerSpec = generated;

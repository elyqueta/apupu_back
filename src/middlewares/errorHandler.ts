import { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import { logger } from '../config/logger';

/**
 * Envelope de erro do contrato:
 *
 * ```json
 * {
 *   "error": {
 *     "code": "validation_failed",
 *     "message": "Verifique os campos indicados.",
 *     "fields": { "starts_at": ["A data deve ser futura."] },
 *     "request_id": "..."
 *   }
 * }
 * ```
 *
 * - `code` é estável para o cliente decidir o que fazer.
 * - `message` é segura para mostrar ao utilizador.
 * - `fields` só aparece em erros de validação.
 * - `request_id` permite cruzar com os logs internos sem expor PII.
 */
interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
    request_id: string;
  };
}

function isBodyParserSyntaxError(
  err: unknown
): err is SyntaxError & { status: number; body: unknown } {
  return (
    err instanceof SyntaxError &&
    'status' in err &&
    (err as { status: unknown }).status === 400 &&
    'body' in err
  );
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.id ?? 'unknown';
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Request-Id', requestId);

  const send = (status: number, body: ErrorEnvelope): void => {
    res.status(status).json(body);
  };

  // Corpo que não é JSON válido — erro do cliente, detetado pelo
  // express.json() antes de qualquer rota.
  if (isBodyParserSyntaxError(err)) {
    send(400, {
      error: {
        code: 'invalid_json',
        message: 'Corpo da requisição não é um JSON válido.',
        request_id: requestId,
      },
    });
    return;
  }

  // Erro operacional previsto pela aplicação.
  if (err instanceof AppError) {
    const error: ErrorEnvelope['error'] & { details?: unknown } = {
      code: err.code,
      message: err.message,
      request_id: requestId,
    };
    if (err.fields) error.fields = err.fields;
    if (err.details !== undefined) error.details = err.details;

    // Erros 5xx operacionais são registados; 4xx são ruído normal.
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, 'Erro operacional 5xx');
    }

    send(err.statusCode, { error });
    return;
  }

  // Erro inesperado: registar internamente, responder genericamente.
  logger.error({ err, requestId }, 'Erro inesperado não tratado');

  send(500, {
    error: {
      code: 'internal_error',
      message: 'Erro interno do servidor.',
      request_id: requestId,
    },
  });
}

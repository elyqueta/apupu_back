import { AppError } from './AppError';

/**
 * Cada subclasse representa uma categoria de erro HTTP comum.
 *
 * O código (`code`) é estável e faz parte do contrato da API; a
 * mensagem é para humanos e pode ser traduzida no frontend. Nunca
 * colocar detalhes internos (SQL, paths, stack) na mensagem.
 */

type Fields = Record<string, string[]>;

/** 400 — a requisição está malformada ou não faz sentido como veio. */
export class BadRequestError extends AppError {
  constructor(message = 'Requisição inválida.', code = 'bad_request', fields?: Fields) {
    super(message, 400, code, fields);
  }
}

/** 401 — falta uma credencial válida. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Não autenticado.', code = 'unauthenticated', fields?: Fields) {
    super(message, 401, code, fields);
  }
}

/** 403 — a credencial existe, mas não autoriza esta ação. */
export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado.', code = 'forbidden', fields?: Fields) {
    super(message, 403, code, fields);
  }
}

/** 404 — o recurso não existe (ou não é visível para esta capacidade). */
export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado.', code = 'not_found', fields?: Fields) {
    super(message, 404, code, fields);
  }
}

/** 409 — a requisição conflita com o estado atual do recurso. */
export class ConflictError extends AppError {
  constructor(
    message = 'Conflito com o estado atual do recurso.',
    code = 'conflict',
    fields?: Fields
  ) {
    super(message, 409, code, fields);
  }
}

/** 429 — demasiados pedidos. */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiados pedidos. Tente novamente mais tarde.', code = 'rate_limited') {
    super(message, 429, code);
  }
}

/** 503 — um serviço externo necessário está indisponível. */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Serviço temporariamente indisponível.', code = 'service_unavailable') {
    super(message, 503, code);
  }
}

/** 422 — dados bem formados, mas inválidos segundo as regras. */
export class ValidationError extends AppError {
  constructor(
    message = 'Verifique os campos indicados.',
    fields?: Fields,
    code = 'validation_failed'
  ) {
    super(message, 422, code, fields);
  }
}

/**
 * Classe base para todos os erros "esperados" (operacionais) da API —
 * erros de negócio, validação, autenticação, recurso não encontrado
 * etc. — em oposição a erros inesperados (bugs, falhas de biblioteca,
 * exceções não previstas).
 *
 * O `errorHandler` usa `instanceof AppError` para decidir entre expor
 * a mensagem (erro previsto, escrita pela aplicação) ou mascará-la
 * (erro inesperado, que pode conter detalhes internos).
 */
export interface AppErrorOptions {
  /** Código estável consumido pelo frontend (ex.: `validation_failed`). */
  code?: string;
  /** Mapa campo → lista de mensagens, usado em erros de validação. */
  fields?: Record<string, string[]>;
}

export abstract class AppError extends Error {
  /** Status HTTP que deve ser retornado ao cliente para este erro. */
  public readonly statusCode: number;

  /** Todo erro criado explicitamente é, por definição, operacional. */
  public readonly isOperational: boolean;

  /** Código estável da máquina (nunca uma mensagem para humanos). */
  public readonly code: string;

  /** Erros por campo, no formato do contrato: `{ campo: ["mensagem"] }`. */
  public readonly fields?: Record<string, string[]>;

  /**
   * Contexto adicional seguro para o cliente (por exemplo, a lista de
   * tarefas abertas que impede remover um membro). Nunca contém dados
   * internos nem PII além do necessário para a acção.
   */
  public readonly details?: unknown;

  protected constructor(
    message: string,
    statusCode: number,
    code: string,
    fields?: Record<string, string[]>,
    details?: unknown
  ) {
    super(message);

    // Necessário ao estender uma classe nativa (Error) em ES2022+:
    // sem isto, `instanceof AppError` pode falhar em alguns cenários.
    Object.setPrototypeOf(this, new.target.prototype);

    this.statusCode = statusCode;
    this.isOperational = true;
    this.code = code;
    this.fields = fields;
    this.details = details;

    // Remove o construtor do stack trace, para o log apontar para o
    // local onde o erro foi lançado.
    Error.captureStackTrace(this, this.constructor);
  }
}

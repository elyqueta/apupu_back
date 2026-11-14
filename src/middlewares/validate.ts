import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodType } from 'zod';
import { ValidationError } from '../errors';

interface ValidationSchemas {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

/**
 * Valida body/params/query com Zod e reatribui o resultado já
 * transformado (coerção de números, normalização de emails, etc.).
 *
 * Os erros são convertidos para o formato de contrato
 * `{ campo: ["mensagem"] }`, para que o frontend os possa mapear
 * diretamente aos inputs.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }

      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as typeof req.query;
      }

      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const fields: Record<string, string[]> = {};

        for (const issue of err.issues) {
          const key = issue.path.length > 0 ? issue.path.join('.') : '_';
          (fields[key] ??= []).push(issue.message);
        }

        next(new ValidationError('Verifique os campos indicados.', fields));
        return;
      }

      next(err);
    }
  };
}

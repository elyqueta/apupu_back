import { z } from 'zod';
import { passwordPolicyIssues } from '../utils/password.util';

/**
 * Contrato de autenticação da conta de anfitrião.
 *
 * O email é normalizado para minúsculas antes de chegar ao serviço: a
 * base de dados usa `citext`, mas normalizar na fronteira evita
 * diferenças subtis entre o valor enviado e o valor persistido.
 */

const emailSchema = z
  .string({ error: 'O email é obrigatório.' })
  .trim()
  .toLowerCase()
  .pipe(z.email('Email inválido.').max(254, 'O email não pode exceder 254 caracteres.'));

const passwordSchema = z
  .string({ error: 'A senha é obrigatória.' })
  .superRefine((value, ctx) => {
    for (const issue of passwordPolicyIssues(value)) {
      ctx.addIssue({ code: 'custom', message: issue });
    }
  });

const tokenSchema = z.string().min(20, 'Token inválido.').max(200);

const otpCodeSchema = z
  .string({ error: 'O código é obrigatório.' })
  .trim()
  .regex(/^\d{6}$/, 'O código deve ter 6 dígitos.');

const displayNameSchema = z
  .string()
  .trim()
  .max(150, 'O nome não pode exceder 150 caracteres.')
  .nullable()
  .optional();

export const registerRequestCodeSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const registerVerifyCodeSchema = z
  .object({
    email: emailSchema,
    code: otpCodeSchema,
  })
  .strict();

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    display_name: displayNameSchema,
    verification_token: tokenSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string({ error: 'A senha é obrigatória.' }).min(1).max(128),
  })
  .strict();

export const verifyEmailSchema = z
  .object({
    token: tokenSchema,
  })
  .strict();

export const resendVerificationSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: tokenSchema,
    password: passwordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    current_password: z.string({ error: 'A senha atual é obrigatória.' }).min(1).max(128),
    new_password: passwordSchema,
  })
  .strict();

export type RegisterBody = z.infer<typeof registerSchema>;
export type RegisterRequestCodeBody = z.infer<typeof registerRequestCodeSchema>;
export type RegisterVerifyCodeBody = z.infer<typeof registerVerifyCodeSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type VerifyEmailBody = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationBody = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>;

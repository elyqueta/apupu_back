import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../src/schemas/auth.schemas';

describe('schemas de autenticação', () => {
  it('normaliza o email para minúsculas e sem espaços', () => {
    const parsed = registerSchema.parse({
      email: '  Ana.Silva@Exemplo.AO ',
      password: 'SenhaSegura#2026',
    });

    expect(parsed.email).toBe('ana.silva@exemplo.ao');
  });

  it('aceita registo válido com display_name opcional', () => {
    expect(
      registerSchema.safeParse({
        email: 'ana@exemplo.ao',
        password: 'SenhaSegura#2026',
        display_name: 'Ana',
      }).success
    ).toBe(true);

    expect(
      registerSchema.safeParse({
        email: 'ana@exemplo.ao',
        password: 'SenhaSegura#2026',
      }).success
    ).toBe(true);
  });

  it('rejeita email inválido, senha curta e senha comum', () => {
    expect(
      registerSchema.safeParse({ email: 'não-é-email', password: 'SenhaSegura#2026' }).success
    ).toBe(false);

    expect(
      registerSchema.safeParse({ email: 'ana@exemplo.ao', password: 'curta' }).success
    ).toBe(false);

    expect(
      registerSchema.safeParse({ email: 'ana@exemplo.ao', password: 'password123' }).success
    ).toBe(false);
  });

  it('rejeita campos desconhecidos no registo', () => {
    const result = registerSchema.safeParse({
      email: 'ana@exemplo.ao',
      password: 'SenhaSegura#2026',
      is_admin: true,
    });

    expect(result.success).toBe(false);
  });

  it('exige senha no login mas não aplica a política de senha', () => {
    expect(loginSchema.safeParse({ email: 'ana@exemplo.ao', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'ana@exemplo.ao', password: '' }).success).toBe(false);
  });

  it('valida tokens de verificação e reposição', () => {
    expect(verifyEmailSchema.safeParse({ token: 'a'.repeat(20) }).success).toBe(true);
    expect(verifyEmailSchema.safeParse({ token: 'curto' }).success).toBe(false);

    expect(
      resetPasswordSchema.safeParse({
        token: 'a'.repeat(20),
        password: 'OutraSenha#2026',
      }).success
    ).toBe(true);
  });

  it('valida reenvio, recuperação e alteração de senha', () => {
    expect(resendVerificationSchema.safeParse({ email: 'ana@exemplo.ao' }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: 'ana@exemplo.ao' }).success).toBe(true);

    expect(
      changePasswordSchema.safeParse({
        current_password: 'SenhaAtual#2026',
        new_password: 'SenhaNova#2026',
      }).success
    ).toBe(true);

    expect(
      changePasswordSchema.safeParse({ current_password: '', new_password: 'SenhaNova#2026' })
        .success
    ).toBe(false);
  });
});

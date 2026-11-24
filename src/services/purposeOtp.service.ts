import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { env } from '../config/env';
import { withTransaction } from '../database/pool';
import { BadRequestError, TooManyRequestsError } from '../errors';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import {
  registrationVerificationRepository,
  VerificationPurpose,
} from '../repositories/registrationVerification.repository';
import { encryptToken } from '../utils/crypto.util';
import { generateOtpCode, hashesMatch, hashOtpCode } from '../utils/token.util';

/**
 * OTP por email para operações sensíveis com finalidade própria (Bloco 11:
 * transferência de responsabilidade de uma comunidade). Reutiliza a tabela
 * `registration_verifications` (coluna `purpose`), o TTL, o limite de
 * tentativas e o intervalo de reenvio do OTP de registo.
 */
export async function requestPurposeOtp(
  email: string,
  purpose: Exclude<VerificationPurpose, 'registration'>,
  payload: Record<string, string>,
  client?: PoolClient
): Promise<{ expiresAt: Date }> {
  const latest = await registrationVerificationRepository.findLatestActiveForEmail(
    email,
    undefined,
    purpose
  );
  if (latest) {
    const resendAt = latest.createdAt.getTime() + env.REGISTRATION_OTP_RESEND_SECONDS * 1000;
    if (resendAt > Date.now()) {
      throw new TooManyRequestsError('Aguarda antes de pedir um novo código.', 'otp_resend_too_soon');
    }
  }

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.REGISTRATION_OTP_TTL_MINUTES * 60_000);

  const run = async (runner: PoolClient): Promise<void> => {
    await registrationVerificationRepository.consumePendingForEmail(email, runner, purpose);
    await registrationVerificationRepository.create(
      email,
      hashOtpCode(email, code),
      expiresAt,
      runner,
      purpose
    );
    await emailDeliveryRepository.enqueue(
      {
        eventId: null,
        invitationId: null,
        hostId: null,
        messageType: 'registration_otp',
        reminderKind: null,
        recipientEmail: email,
        scheduledFor: new Date(),
        idempotencyKey: `${purpose}_otp:${email}:${randomUUID()}`,
        tokenEncrypted: encryptToken(code),
        payload: { ...payload, purpose },
      },
      runner
    );
  };

  if (client) {
    await run(client);
  } else {
    await withTransaction(run);
  }

  return { expiresAt };
}

/**
 * Verifica e consome o OTP. As falhas incrementam tentativas numa
 * transacção própria, para não serem anuladas por um rollback.
 */
export async function assertPurposeOtp(
  email: string,
  purpose: Exclude<VerificationPurpose, 'registration'>,
  code: string
): Promise<void> {
  const outcome = await withTransaction(async (client) => {
    const verification = await registrationVerificationRepository.findLatestActiveForEmailForUpdate(
      email,
      client,
      purpose
    );
    if (!verification || verification.attempts >= env.REGISTRATION_OTP_MAX_ATTEMPTS) {
      return 'attempts_exceeded' as const;
    }
    if (!hashesMatch(verification.codeHash, hashOtpCode(email, code))) {
      const attempts = await registrationVerificationRepository.registerFailedAttempt(
        verification.id,
        client
      );
      if (attempts >= env.REGISTRATION_OTP_MAX_ATTEMPTS) {
        await registrationVerificationRepository.consumePendingForEmail(email, client, purpose);
      }
      return 'invalid' as const;
    }
    await registrationVerificationRepository.consumeCode(verification.id, client);
    return 'valid' as const;
  });

  if (outcome !== 'valid') {
    throw new BadRequestError(
      outcome === 'attempts_exceeded'
        ? 'Demasiadas tentativas. Pede um novo código.'
        : 'Código inválido ou expirado.',
      'otp_invalid'
    );
  }
}

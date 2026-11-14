import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { env } from '../config/env';

/**
 * Cifra simétrica dos tokens de convite.
 *
 * Porque não guardar só o hash? Porque os lembretes e o reenvio de
 * convites precisam de reconstruir o link original. Guardar o token
 * em claro exporia todos os convites numa fuga da base de dados;
 * guardá-lo cifrado com uma chave derivada do pepper da aplicação
 * mantém o link recuperável apenas por quem tem a chave.
 *
 * Formato: base64url(iv).base64url(tag).base64url(ciphertext)
 * Algoritmo: AES-256-GCM (confidencialidade + autenticidade).
 */
const KEY = scryptSync(env.TOKEN_PEPPER, 'apupu-invite-token-v1', 32);
const IV_BYTES = 12;

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, ciphertext].map((buffer) => buffer.toString('base64url')).join('.');
}

export function decryptToken(payload: string): string {
  const [ivPart, tagPart, ciphertextPart] = payload.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Token cifrado com formato inválido.');
  }

  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]);

  return plain.toString('utf8');
}

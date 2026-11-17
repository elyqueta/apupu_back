/**
 * Formas de acesso a um convite público.
 *
 * - `capability`: cookie HttpOnly emitido no primeiro claim, ligado ao
 *   navegador;
 * - `account`: sessão de conta (`apupu_auth`) cujo email verificado
 *   coincide com o email do convite. Permite abrir e responder ao
 *   convite em qualquer navegador.
 *
 * `secret` é sempre o valor de onde deriva o token CSRF — a capacidade
 * do navegador ou o token da sessão de conta. Nunca é serializado.
 */
export type GuestAccess =
  | { kind: 'capability'; secret: string }
  | { kind: 'account'; secret: string; email: string };

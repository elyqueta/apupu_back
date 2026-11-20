import passport from 'passport';
import type { Authenticator } from 'passport';
import type { RequestHandler } from 'express';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import { env } from './env';
import { logger } from './logger';
import { hostRepository } from '../repositories/host.repository';

/**
 * Passport com tipos concretos de middleware do Express.
 *
 * `@types/passport` usa `any` como tipo de retorno por omissão; este
 * alias permite usar `authenticate(...)` como `RequestHandler` sem
 * chamadas `any` (o lint do projeto proíbe isso).
 */
export const typedPassport = passport as unknown as Authenticator<
  RequestHandler,
  RequestHandler,
  RequestHandler
>;

/**
 * Perfil do Google normalizado para a aplicação.
 *
 * `Profile` (de `passport-google-oauth20`) é o tipo bruto da estratégia.
 * Daqui expomos apenas os campos que a API devolve no callback, mantendo
 * `req.user` fortemente tipado (ver `src/types/express/index.d.ts`).
 */
export interface GoogleProfile {
  provider: 'google';
  id: string;
  displayName: string;
  name: {
    familyName?: string;
    givenName?: string;
    middleName?: string;
  };
  emails: Array<{ value: string; verified?: boolean; type?: string }>;
  photos: Array<{ value: string }>;
  profileUrl?: string;
  /** `true` quando o Google confirma que o email é verificado. */
  emailVerified: boolean;
  /** ID da conta local (`hosts.id`) após resolver a identidade. */
  localUserId?: string;
}

/** Converte o `Profile` da estratégia no formato usado pela API. */
export function toGoogleProfile(profile: Profile): GoogleProfile {
  return {
    provider: profile.provider,
    id: profile.id,
    displayName: profile.displayName,
    name: profile.name ?? {},
    emails: profile.emails ?? [],
    photos: profile.photos ?? [],
    profileUrl: profile.profileUrl,
    emailVerified: profile._json?.email_verified ?? false,
  };
}

interface GoogleOAuthConfig {
  clientID: string;
  clientSecret: string;
  callbackURL: string;
}

/** Devolve a configuração apenas quando as três variáveis estão preenchidas. */
function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CALLBACK_URL } = env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !CALLBACK_URL) {
    return null;
  }

  return {
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
  };
}

/** True quando as rotas `/auth/google*` podem ser usadas. */
export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthConfig() !== null;
}

/**
 * Regista a estratégia `google` no Passport.
 *
 * Chamada uma única vez no arranque da aplicação. Com as variáveis de
 * ambiente vazias (`.env.example`) a estratégia não é registada e a API
 * continua a arrancar; as rotas respondem 503 com uma mensagem clara.
 */
export function configurePassport(): void {
  const config = getGoogleOAuthConfig();

  if (!config) {
    logger.warn(
      'Google OAuth2 desativado: defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e CALLBACK_URL para ativar /auth/google.'
    );
    return;
  }

  typedPassport.use(
    new GoogleStrategy(config, (_accessToken, _refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value?.trim();

      if (!email) {
        done(new Error('O Google não devolveu um email para a conta.'));
        return;
      }

      const identity = {
        googleId: profile.id,
        email,
        displayName: profile.displayName?.trim() || email.split('@')[0] || 'Utilizador Google',
        avatarUrl: profile.photos?.[0]?.value ?? null,
        emailVerified: profile._json?.email_verified ?? false,
      };

      // Não marcamos o verify callback como `async`: Passport espera um
      // retorno `void` e o lint do projeto proíbe promessas nesse ponto.
      hostRepository
        .findOrCreateFromGoogle(identity)
        .then((user) => {
          done(null, { ...toGoogleProfile(profile), localUserId: user.id });
        })
        .catch((error: unknown) => {
          done(error instanceof Error ? error : new Error(String(error)));
        });
    })
  );
}

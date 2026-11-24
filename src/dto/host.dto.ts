import { HostWithProfile } from '../types/host.types';

/**
 * Vista pública da conta.
 *
 * Nunca inclui `password_hash`, contadores de login, `locked_until`
 * nem tokens. `birth_date` é PII e só é devolvida ao próprio
 * anfitrião, que é sempre o destinatário destes DTOs.
 */
export interface HostProfileDto {
  display_name: string | null;
  phone: string | null;
  birth_date: string | null;
  locale: string;
  timezone: string;
  avatar_url: string | null;
  cover_url: string | null;
  /** `private` por defeito; um perfil privado não aparece em pesquisas. */
  profile_visibility: 'public' | 'private';
}

export interface HostDto {
  id: string;
  email: string;
  email_verified: boolean;
  status: string;
  /** Papel da conta; usado pelo painel de administração do Bloco 6. */
  is_super_admin: boolean;
  profile: HostProfileDto;
  profile_complete: boolean;
  missing_fields: string[];
  created_at: string;
}

/** Campos que, em falta, tornam o perfil incompleto. */
export function missingProfileFields(host: HostWithProfile): string[] {
  const missing: string[] = [];

  if (!host.profile.birthDate) {
    missing.push('birth_date');
  }

  return missing;
}

export function toHostDto(host: HostWithProfile): HostDto {
  const missing = missingProfileFields(host);

  return {
    id: host.id,
    email: host.email,
    email_verified: host.emailVerifiedAt !== null,
    status: host.status,
    is_super_admin: host.isSuperAdmin,
    profile: {
      display_name: host.profile.displayName,
      phone: host.profile.phone,
      birth_date: host.profile.birthDate,
      locale: host.profile.locale,
      timezone: host.profile.timezone,
      avatar_url: host.profile.avatarUrl,
      cover_url: host.profile.coverUrl,
      profile_visibility: host.profile.visibility,
    },
    profile_complete: missing.length === 0,
    missing_fields: missing,
    created_at: host.createdAt.toISOString(),
  };
}

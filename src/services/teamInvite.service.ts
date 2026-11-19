import { PoolClient } from 'pg';
import { withTransaction } from '../database/pool';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
} from '../errors';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { hostRepository } from '../repositories/host.repository';
import { teamInviteRepository } from '../repositories/teamInvite.repository';
import { teamMemberRepository } from '../repositories/teamMember.repository';
import { EventAccessScope } from '../types/event.types';
import {
  TeamInvite,
  TeamInviteContext,
  TeamMemberWithStats,
  TeamWithStats,
} from '../types/team.types';
import { env } from '../config/env';
import { generateToken, hashesMatch, hashToken } from '../utils/token.util';
import { assertCanManageTeam, resolveTeamAccess } from './teamAccess.service';
import { notifyTeamInvite } from './teamNotification.service';

/**
 * Convites de equipa por email.
 *
 * O token em claro só existe:
 * - na resposta da criação/reenvio (nunca na API pública);
 * - no email cifrado da outbox.
 *
 * A base de dados guarda apenas o HMAC. A aceitação exige sessão de
 * conta com email verificado e coincidente com o do convite.
 *
 * O token é aleatório (32 bytes), de uso único, expira em 7 dias e é
 * invalidado por cada reenvio. A comparação do hash é feita em tempo
 * constante. Como o token é um portador com estado (linha em
 * `team_invites`), a revogação e o uso único são reais; um HMAC sem
 * estado não conseguiria garantir nenhuma das duas coisas.
 */

const INVITE_NOT_FOUND = 'Convite não encontrado.';
const MEMBER_NOT_FOUND = 'Membro não encontrado.';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface TeamInvitePreview {
  team_name: string;
  invited_by: string;
}

export interface TeamInviteAcceptResult {
  member_id: string;
  team_id: string;
  team_name: string;
  event_id: string;
  event_title: string;
  role: string;
}

export interface TeamInviteResendResult {
  send_count: number;
  last_sent_at: string;
  expires_at: string;
}

/** Esconde a parte local do email em diagnósticos. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';

  const visible = local.slice(0, 1);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}

function expiryLabel(): string {
  return `${env.TEAM_INVITE_TTL_DAYS} dias`;
}

function expiresAt(): Date {
  return new Date(Date.now() + env.TEAM_INVITE_TTL_DAYS * DAY_MS);
}

function inviteCooldownMs(): number {
  return env.TEAM_INVITE_RESEND_COOLDOWN_MINUTES * 60 * 1000;
}

async function actorName(scope: EventAccessScope): Promise<string> {
  const host = await hostRepository.findById(scope.hostId);
  return host?.profile.displayName?.trim() || host?.email || 'O anfitrião';
}

function assertInviteUsable(invite: TeamInviteContext): void {
  if (invite.revokedAt) {
    throw new ConflictError('Este convite já não é válido.', 'invite_revoked');
  }

  if (invite.acceptedAt) {
    throw new ConflictError('Este convite já foi aceite.', 'invite_already_accepted');
  }

  if (invite.expiresAt.getTime() <= Date.now()) {
    throw new ConflictError('Este convite expirou.', 'invite_expired');
  }

  if (invite.memberRemovedAt) {
    throw new NotFoundError(INVITE_NOT_FOUND, 'invite_not_found');
  }
}

/**
 * Limites por email. A mensagem é genérica e em pt-PT: não revela
 * quantas contas existem nem o histórico do endereço.
 */
async function assertEmailRateLimit(
  email: string,
  client: PoolClient
): Promise<void> {
  const since = new Date(Date.now() - DAY_MS);
  const recent = await teamInviteRepository.countRecentByEmail(email, since, client);

  if (recent >= env.TEAM_INVITE_MAX_PER_EMAIL_PER_DAY) {
    throw new TooManyRequestsError(
      'Foram criados demasiados convites para este email nas últimas 24 horas. Tente novamente mais tarde.',
      'invite_email_rate_limited'
    );
  }
}

/** Limites por anfitrião: 30 por hora e 100 por dia, configuráveis. */
async function assertHostRateLimit(
  hostId: string,
  client: PoolClient
): Promise<void> {
  const [lastHour, lastDay] = await Promise.all([
    teamInviteRepository.countRecentByHost(hostId, new Date(Date.now() - HOUR_MS), client),
    teamInviteRepository.countRecentByHost(hostId, new Date(Date.now() - DAY_MS), client),
  ]);

  if (lastHour >= env.TEAM_INVITE_MAX_PER_HOST_PER_HOUR) {
    throw new TooManyRequestsError(
      'Foram criados demasiados convites por este anfitrião na última hora. Tente novamente mais tarde.',
      'invite_host_rate_limited'
    );
  }

  if (lastDay >= env.TEAM_INVITE_MAX_PER_HOST_PER_DAY) {
    throw new TooManyRequestsError(
      'Foram criados demasiados convites por este anfitrião nas últimas 24 horas. Tente novamente mais tarde.',
      'invite_host_rate_limited'
    );
  }
}

/**
 * Cria o convite e enfileira o email para um membro pendente.
 *
 * Devolve `invite: null` com um motivo estável apenas quando o membro
 * não é elegível ou o remetente está bloqueado. Os limites anti-spam
 * lançam `429`, para que o cliente saiba que deve esperar.
 */
export async function createInviteForMember(data: {
  member: TeamMemberWithStats;
  team: TeamWithStats;
  actorName: string;
  actorHostId: string;
  client: PoolClient;
}): Promise<{ invite: TeamInvite | null; reason?: string }> {
  const { member, team, client } = data;

  if (member.status !== 'convite_pendente' || member.removedAt) {
    return { invite: null, reason: 'member_not_pending' };
  }

  if (!member.email) {
    return { invite: null, reason: 'member_without_email' };
  }

  // O anfitrião denunciado não pode voltar a convidar aquele email.
  // O motivo é genérico de propósito.
  if (await teamInviteRepository.isBlocked(data.actorHostId, member.email, client)) {
    return { invite: null, reason: 'invite_not_possible' };
  }

  await assertEmailRateLimit(member.email, client);
  await assertHostRateLimit(data.actorHostId, client);

  await teamInviteRepository.revokeActiveForMember(member.id, client);

  const token = generateToken();
  const invite = await teamInviteRepository.create(
    {
      memberId: member.id,
      teamId: team.id,
      email: member.email,
      createdByHostId: data.actorHostId,
      tokenHash: hashToken(token),
      expiresAt: expiresAt(),
    },
    client
  );

  await notifyTeamInvite(
    {
      inviteId: invite.id,
      sendCount: invite.sendCount,
      recipientEmail: member.email,
      recipientName: member.displayName,
      team,
      actorName: data.actorName,
      tokenPlain: token,
      expiryLabel: expiryLabel(),
    },
    client
  );

  return { invite };
}

export const teamInviteService = {
  /** Cria o convite de equipa para um membro pendente. */
  async createForMember(
    scope: EventAccessScope,
    team: TeamWithStats,
    member: TeamMemberWithStats,
    client: PoolClient
  ): Promise<{ invite: TeamInvite | null; reason?: string }> {
    return createInviteForMember({
      member,
      team,
      actorName: await actorName(scope),
      actorHostId: scope.hostId,
      client,
    });
  },

  /**
   * Reenvia o convite.
   *
   * Anti-spam: cooldown de 10 minutos entre envios, máximo de 5 por
   * convite, máximo de 3 emails por destinatário em 24 horas e limites
   * por anfitrião (30/hora e 100/dia). Cada reenvio rotaciona o token;
   * o link anterior fica inválido.
   */
  async resend(
    scope: EventAccessScope,
    teamId: string,
    memberId: string
  ): Promise<TeamInviteResendResult> {
    const access = await resolveTeamAccess(teamId, scope);
    assertCanManageTeam(access.role);

    const name = await actorName(scope);
    const since = new Date(Date.now() - DAY_MS);

    return withTransaction(async (client) => {
      // Bloqueia o membro: dois reenvios simultâneos passam a correr em
      // série e o segundo vê o cooldown já aplicado pelo primeiro.
      const member = await teamMemberRepository.findByIdForUpdate(memberId, client);

      if (!member || member.teamId !== teamId || member.removedAt) {
        throw new NotFoundError(MEMBER_NOT_FOUND, 'team_member_not_found');
      }

      if (member.status !== 'convite_pendente') {
        throw new ConflictError(
          'Este membro já tem acesso ao evento; não é necessário reenviar o convite.',
          'member_already_active'
        );
      }

      if (!member.email) {
        throw new ConflictError(
          'Este membro não tem email para receber o convite.',
          'member_without_email'
        );
      }

      if (await teamInviteRepository.isBlocked(scope.hostId, member.email, client)) {
        throw new ConflictError(
          'Não foi possível convidar este email.',
          'invite_not_possible'
        );
      }

      const active = await teamInviteRepository.findActiveByMemberId(memberId, client);

      if (!active) {
        const created = await createInviteForMember({
          member,
          team: access.team,
          actorName: name,
          actorHostId: scope.hostId,
          client,
        });

        if (!created.invite) {
          throw new ConflictError(
            'Não foi possível convidar este email.',
            created.reason ?? 'invite_not_created'
          );
        }

        return {
          send_count: created.invite.sendCount,
          last_sent_at: created.invite.lastSentAt.toISOString(),
          expires_at: created.invite.expiresAt.toISOString(),
        };
      }

      if (active.sendCount >= env.TEAM_INVITE_MAX_SENDS) {
        throw new ConflictError(
          'Este convite atingiu o limite de reenvios. Crie um novo convite mais tarde.',
          'invite_send_limit'
        );
      }

      if (Date.now() - active.lastSentAt.getTime() < inviteCooldownMs()) {
        throw new TooManyRequestsError(
          'Aguarde alguns minutos antes de reenviar o convite.',
          'invite_cooldown'
        );
      }

      const recent = await emailDeliveryRepository.countRecentByRecipient(
        member.email,
        'team_invite',
        since,
        client
      );

      if (recent >= env.TEAM_INVITE_MAX_PER_EMAIL_PER_DAY) {
        throw new TooManyRequestsError(
          'Foram enviados demasiados convites para este email nas últimas 24 horas. Tente novamente mais tarde.',
          'invite_email_rate_limited'
        );
      }

      await assertHostRateLimit(scope.hostId, client);

      const token = generateToken();
      const rotated = await teamInviteRepository.rotate(
        active.id,
        { tokenHash: hashToken(token), expiresAt: expiresAt() },
        client
      );

      if (!rotated) {
        throw new ConflictError('Este convite já não é válido.', 'invite_not_active');
      }

      await notifyTeamInvite(
        {
          inviteId: rotated.id,
          sendCount: rotated.sendCount,
          recipientEmail: member.email,
          recipientName: member.displayName,
          team: access.team,
          actorName: name,
          tokenPlain: token,
          expiryLabel: expiryLabel(),
        },
        client
      );

      return {
        send_count: rotated.sendCount,
        last_sent_at: rotated.lastSentAt.toISOString(),
        expires_at: rotated.expiresAt.toISOString(),
      };
    });
  },

  /**
   * Valida o token para a página pública.
   *
   * A página mostra apenas o nome da equipa e quem convida. Não
   * revela o email convidado, o evento, a validade nem o estado do
   * convite.
   */
  async preview(token: string): Promise<TeamInvitePreview> {
    const hash = hashToken(token);
    const invite = await teamInviteRepository.findByTokenHash(hash);

    // Comparação explícita em tempo constante. O lookup por hash já é
    // indexado, mas esta verificação documenta a garantia e protege
    // contra uma futura alteração do repositório.
    if (!invite || !hashesMatch(invite.tokenHash, hash)) {
      throw new NotFoundError(INVITE_NOT_FOUND, 'invite_not_found');
    }

    assertInviteUsable(invite);

    return {
      team_name: invite.teamName,
      invited_by: invite.inviterName?.trim() || 'O anfitrião',
    };
  },

  /**
   * Aceita o convite.
   *
   * Exige sessão de conta com email verificado e coincidente com o
   * email convidado. A transição é atómica: o `UPDATE` condicional do
   * convite garante que dois pedidos concorrentes não o aceitam duas
   * vezes.
   */
  async accept(
    token: string,
    account: { hostId: string; email: string; displayName: string | null; emailVerified: boolean }
  ): Promise<TeamInviteAcceptResult> {
    if (!account.emailVerified) {
      throw new ForbiddenError(
        'Confirme o seu email antes de aceitar o convite.',
        'email_not_verified'
      );
    }

    const hash = hashToken(token);

    return withTransaction(async (client) => {
      const invite = await teamInviteRepository.findByTokenHashForUpdate(hash, client);

      if (!invite || !hashesMatch(invite.tokenHash, hash)) {
        throw new NotFoundError(INVITE_NOT_FOUND, 'invite_not_found');
      }

      assertInviteUsable(invite);

      if (invite.email.toLowerCase() !== account.email.trim().toLowerCase()) {
        throw new ForbiddenError(
          'Este convite foi enviado para outro email.',
          'invite_email_mismatch'
        );
      }

      const accepted = await teamInviteRepository.accept(invite.id, client);

      if (!accepted) {
        throw new ConflictError('Este convite já não é válido.', 'invite_not_active');
      }

      const member = await teamMemberRepository.acceptInvite(
        invite.memberId,
        { hostId: account.hostId, displayName: account.displayName },
        client
      );

      if (!member || member.removedAt || member.status !== 'ativo') {
        throw new ConflictError('Este convite já não é válido.', 'invite_not_active');
      }

      await emailDeliveryRepository.cancelPendingByPayload(
        'team_invite',
        'inviteId',
        invite.id,
        client
      );

      return {
        member_id: member.id,
        team_id: invite.teamId,
        team_name: invite.teamName,
        event_id: invite.eventId,
        event_title: invite.eventTitle,
        role: member.role,
      };
    });
  },

  /**
   * "Não conheço este convite".
   *
   * Revoga o convite, cancela os emails pendentes e bloqueia o
   * remetente original para aquele email. Responde sempre da mesma
   * forma (o controlador devolve `204`) para não permitir enumerar
   * tokens: um token inválido e um token válido são indistinguíveis.
   */
  async reportUnknown(token: string): Promise<void> {
    const hash = hashToken(token);

    await withTransaction(async (client) => {
      const invite = await teamInviteRepository.findByTokenHashForUpdate(hash, client);

      if (!invite || !hashesMatch(invite.tokenHash, hash)) return;
      if (invite.acceptedAt) return;

      if (invite.createdByHostId) {
        await teamInviteRepository.block(
          invite.createdByHostId,
          invite.email,
          'unknown_invite',
          client
        );
      }

      await teamInviteRepository.revokeActiveForMember(invite.memberId, client);
      await emailDeliveryRepository.cancelPendingTeamInvitesForMember(
        invite.memberId,
        client
      );
    });
  },

  /** Revoga convites activos e cancela os emails pendentes do membro. */
  async revokeForMember(memberId: string, client?: PoolClient): Promise<number> {
    const revoked = await teamInviteRepository.revokeActiveForMember(memberId, client);
    await emailDeliveryRepository.cancelPendingTeamInvitesForMember(memberId, client);
    return revoked;
  },
};

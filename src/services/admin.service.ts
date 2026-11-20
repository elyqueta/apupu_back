import { ForbiddenError, NotFoundError } from '../errors';
import { adminAuditRepository } from '../repositories/adminAudit.repository';
import {
  adminProfileRepository,
  AdminProfileEvent,
  AdminProfileTeam,
} from '../repositories/adminProfile.repository';
import { eventRepository } from '../repositories/event.repository';
import { hostAuthSessionRepository } from '../repositories/hostAuthSession.repository';
import { hostRepository, AdminUserListItem, toAdminUserListItem } from '../repositories/host.repository';
import { invitationRepository } from '../repositories/invitation.repository';
import {
  AdminAuditQuery,
  AdminEventsQuery,
  AdminUsersQuery,
} from '../schemas/admin.schemas';
import { Event, EventRecord, EventWithStats } from '../types/event.types';
import { HostWithProfile } from '../types/host.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';
import {
  assertEventCancelOtp,
  CancelOtpRequestResult,
  requestEventCancelOtp,
} from './auth.service';
import { eventService } from './event.service';

/** Detalhe de conta devolvido ao modal de perfil do painel admin. */
export interface AdminUserDetailDto extends AdminUserListItem {
  events: AdminProfileEvent[];
  teams: AdminProfileTeam[];
}

interface AdminActivityDto {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
}

interface AdminAuditDto extends AdminActivityDto {
  admin_id: string;
  reason: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Serviço do painel de super admin.
 *
 * As listagens também são auditadas: o documento-fonte pede registo de
 * todas as acções admin, incluindo consultas. Nenhuma senha, token ou
 * OTP entra na auditoria.
 */
export const adminService = {
  async overview(adminId: string): Promise<{
    stats: {
      users: number;
      active_events: number;
      cancelled_events: number;
      invitations_sent: number;
    };
    recent_activity: AdminActivityDto[];
  }> {
    await adminAuditRepository.record({
      adminId,
      action: 'admin_overview_viewed',
      targetType: 'admin',
      targetId: adminId,
    });

    const result = await Promise.all([
      eventRepository.countAll(),
      invitationRepository.countAll(),
      adminAuditRepository.recent(10),
    ]);

    return {
      stats: {
        users: result[0].hosts,
        active_events: result[0].active,
        cancelled_events: result[0].cancelled,
        invitations_sent: result[1],
      },
      recent_activity: result[2].map((entry) => ({
        id: entry.id,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        created_at: entry.createdAt.toISOString(),
      })),
    };
  },

  async listEvents(
    adminId: string,
    query: AdminEventsQuery
  ): Promise<{ items: EventWithStats[]; pagination: PaginationMeta }> {
    await adminAuditRepository.record({
      adminId,
      action: 'admin_events_listed',
      targetType: 'admin',
      targetId: adminId,
      metadata: { q: query.q ?? null, status: query.status ?? null },
    });

    const page = toPageParams(query.page, query.page_size);
    const result = await eventRepository.listForAdmin({
      q: query.q,
      status: query.status,
      host: query.host,
      from: query.from,
      to: query.to,
      order: query.order ?? 'desc',
      ...page,
    });

    return { items: result.items, pagination: buildPaginationMeta(result.total, page.page, page.pageSize) };
  },

  async getEvent(adminId: string, eventId: string): Promise<EventRecord> {
    const event = await eventRepository.findById(eventId);
    if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

    await adminAuditRepository.record({
      adminId,
      action: 'admin_event_viewed',
      targetType: 'event',
      targetId: eventId,
    });
    return event;
  },

  async requestEventCancelOtp(
    adminId: string,
    eventId: string,
    email: string
  ): Promise<CancelOtpRequestResult> {
    const event = await eventRepository.findById(eventId);
    if (!event) throw new NotFoundError('Evento não encontrado.', 'event_not_found');

    const result = await requestEventCancelOtp(email);

    await adminAuditRepository.record({
      adminId,
      action: 'admin_cancel_otp_requested',
      targetType: 'event',
      targetId: eventId,
    });

    return result;
  },

  async cancelEvent(
    adminId: string,
    eventId: string,
    reason: string,
    otp: string
  ): Promise<Event> {
    const admin = await hostRepository.findById(adminId);
    if (!admin) throw new ForbiddenError('Conta não encontrada.', 'admin_forbidden');

    await assertEventCancelOtp(admin.email, otp);
    return eventService.cancel(eventId, { hostId: adminId, role: 'plataforma' }, reason);
  },

  async listUsers(
    adminId: string,
    query: AdminUsersQuery
  ): Promise<{ items: AdminUserListItem[]; pagination: PaginationMeta }> {
    await adminAuditRepository.record({
      adminId,
      action: 'admin_users_listed',
      targetType: 'admin',
      targetId: adminId,
      metadata: { q: query.q ?? null, role: query.role ?? null, status: query.status ?? null },
    });

    const page = toPageParams(query.page, query.page_size);
    const result = await hostRepository.listForAdmin({
      q: query.q,
      role: query.role,
      status: query.status,
      from: query.from,
      order: query.order ?? 'desc',
      ...page,
    });

    return { items: result.items, pagination: buildPaginationMeta(result.total, page.page, page.pageSize) };
  },

  async getUser(adminId: string, userId: string): Promise<AdminUserDetailDto> {
    const host = await hostRepository.findById(userId);
    if (!host) throw new NotFoundError('Utilizador não encontrado.', 'user_not_found');

    await adminAuditRepository.record({
      adminId,
      action: 'admin_user_viewed',
      targetType: 'host',
      targetId: userId,
    });

    const [events, teams] = await Promise.all([
      adminProfileRepository.eventsForUser(userId, 50),
      adminProfileRepository.teamsForUser(userId, 50),
    ]);

    return { ...toAdminUserListItem(host), events, teams };
  },

  async suspendUser(
    adminId: string,
    userId: string,
    reason?: string | null
  ): Promise<HostWithProfile | null> {
    const host = await hostRepository.findById(userId);
    if (!host) throw new NotFoundError('Utilizador não encontrado.', 'user_not_found');
    if (host.isSuperAdmin || userId === adminId) {
      throw new ForbiddenError(
        'Não é possível suspender a própria conta nem outro super admin.',
        'admin_self_action'
      );
    }
    if (host.status === 'suspended') return host;

    await hostRepository.setStatus(userId, 'suspended');
    await hostAuthSessionRepository.revokeAllForHost(userId);
    await adminAuditRepository.record({
      adminId,
      action: 'admin_user_suspended',
      targetType: 'host',
      targetId: userId,
      reason: reason ?? null,
    });
    return hostRepository.findById(userId);
  },

  async reactivateUser(adminId: string, userId: string): Promise<HostWithProfile | null> {
    const host = await hostRepository.findById(userId);
    if (!host) throw new NotFoundError('Utilizador não encontrado.', 'user_not_found');
    if (host.status !== 'suspended') return host;

    await hostRepository.setStatus(userId, 'active');
    await adminAuditRepository.record({
      adminId,
      action: 'admin_user_reactivated',
      targetType: 'host',
      targetId: userId,
    });
    return hostRepository.findById(userId);
  },

  async revokeSessions(adminId: string, userId: string): Promise<{ revoked: number }> {
    const host = await hostRepository.findById(userId);
    if (!host) throw new NotFoundError('Utilizador não encontrado.', 'user_not_found');
    if (userId === adminId) {
      throw new ForbiddenError(
        'Não podes revogar as tuas próprias sessões a partir desta área.',
        'admin_self_action'
      );
    }

    const revoked = await hostAuthSessionRepository.revokeAllForHost(userId);
    await adminAuditRepository.record({
      adminId,
      action: 'admin_sessions_revoked',
      targetType: 'host',
      targetId: userId,
      metadata: { sessions: revoked },
    });
    return { revoked };
  },

  async listAudit(
    adminId: string,
    query: AdminAuditQuery
  ): Promise<{ items: AdminAuditDto[]; pagination: PaginationMeta }> {
    const page = toPageParams(query.page, query.page_size);
    const result = await adminAuditRepository.list({
      q: query.q,
      action: query.action,
      from: query.from,
      to: query.to,
      ...page,
    });

    await adminAuditRepository.record({
      adminId,
      action: 'admin_audit_listed',
      targetType: 'admin',
      targetId: adminId,
      metadata: { q: query.q ?? null, action: query.action ?? null },
    });

    return {
      items: result.items.map((entry) => ({
        id: entry.id,
        admin_id: entry.adminId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        reason: entry.reason,
        metadata: entry.metadata,
        created_at: entry.createdAt.toISOString(),
      })),
      pagination: buildPaginationMeta(result.total, page.page, page.pageSize),
    };
  },
};

import { CommunityMemberStatus, CommunityRole } from '../types/community.types';

/**
 * Permissões das comunidades num único módulo (Bloco 11).
 *
 * Funções puras sobre o papel activo de quem pede. `null` significa que a
 * conta não é membro activo. Testadas por papel em `tests/bloco11.test.ts`.
 */
export interface CommunityActor {
  role: CommunityRole | null;
  status: CommunityMemberStatus | null;
  /** Conta com acesso de anfitrião (todas as contas activas o são hoje). */
  isHostAccount: boolean;
}

const isActive = (actor: CommunityActor): boolean => actor.status === 'active' && actor.role !== null;

const isStaff = (actor: CommunityActor): boolean =>
  isActive(actor) && (actor.role === 'owner' || actor.role === 'manager');

export const communityPermissions = {
  /** Ver membros, equipas e eventos privados da comunidade. */
  canViewMembers: (actor: CommunityActor): boolean => isActive(actor),
  canEditSettings: isStaff,
  canDeleteCommunity: (actor: CommunityActor): boolean => isActive(actor) && actor.role === 'owner',
  canInviteMembers: isStaff,
  canDecideJoinRequests: isStaff,
  /** Gestores removem membros; só o responsável remove gestores. */
  canRemoveMember: (actor: CommunityActor, target: CommunityRole): boolean => {
    if (!isStaff(actor) || target === 'owner') return false;
    if (target === 'manager') return actor.role === 'owner';
    return true;
  },
  /** Só o responsável promove/despromove gestores. */
  canChangeRole: (actor: CommunityActor): boolean => isActive(actor) && actor.role === 'owner',
  /** O responsável não sai sem transferir antes. */
  canLeave: (actor: CommunityActor): boolean => isActive(actor) && actor.role !== 'owner',
  canCreateEvent: (actor: CommunityActor): boolean => isStaff(actor) && actor.isHostAccount,
  canEditEvents: isStaff,
  /** Eventos sem confirmados: gestores e responsável; com confirmados: só o responsável. */
  canDeleteEvent: (actor: CommunityActor, acceptedCount: number): boolean =>
    acceptedCount > 0 ? isActive(actor) && actor.role === 'owner' : isStaff(actor),
  canCreateTeam: (actor: CommunityActor): boolean => isStaff(actor) && actor.isHostAccount,
  /** Membros partilham eventos públicos e convidam pessoas para eles. */
  canShareEvents: (actor: CommunityActor): boolean => isActive(actor),
  canViewAllReferrals: isStaff,
  canStartTransfer: (actor: CommunityActor): boolean => isActive(actor) && actor.role === 'owner',
  /** O destinatário tem de ser gestor ou membro com conta de anfitrião. */
  canReceiveTransfer: (target: CommunityActor): boolean =>
    isActive(target) && target.role !== 'owner' && target.isHostAccount,
  /** Pedir adesão: só comunidades públicas e quem ainda não é membro. */
  canRequestToJoin: (actor: CommunityActor, visibility: 'public' | 'private'): boolean =>
    visibility === 'public' && !isActive(actor),
};

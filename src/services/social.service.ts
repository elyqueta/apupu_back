import { ConflictError, NotFoundError, TooManyRequestsError, ValidationError } from '../errors';
import { institutionRepository } from '../repositories/institution.repository';
import { notificationRepository } from '../repositories/notification.repository';
import {
  FeedCommunityRow,
  FeedEventRow,
  FeedPersonRow,
  socialRepository,
} from '../repositories/social.repository';
import { effectiveEventStatus } from '../utils/eventStatus.util';
import { links } from '../utils/links.util';

export const FEED_PAGE_SIZE = 12;
export const SEARCH_GROUP_LIMIT = 5;
/** Limite diário de pedidos de amizade por conta. */
export const FRIEND_REQUESTS_PER_DAY = 30;

export type FeedType = 'events' | 'communities' | 'people';

/** Cursor opaco: deslocamento em base64url. */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  return Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : 0;
}

/* ──────────────────────────────── DTOs ──────────────────────────────── */

export function toFeedEventDto(row: FeedEventRow) {
  const status = effectiveEventStatus({
    status: row.status as any,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
  });
  return {
    type: 'event' as const,
    id: row.id,
    title: row.title,
    category: row.category,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at ? row.ends_at.toISOString() : null,
    timezone: row.timezone,
    status,
    location: row.location_type === 'online' ? null : row.location_name,
    online: row.location_type === 'online',
    cover_url: row.cover_url,
    /** Estilo do template para pré-visualizar sem capa (sem dados privados). */
    template: { id: row.template_id, palette: row.theme?.palette ?? 'default', mode: row.theme?.mode ?? 'light' },
    host_name: row.host_name,
    /** Mesma imagem pública do contacto do anfitrião no convite. */
    host_avatar_url: row.host_avatar_url,
    /** Início da mensagem pública do convite (máx. 220 caracteres). */
    excerpt: row.excerpt,
    published_at: row.created_at.toISOString(),
    public_url: links.publicEvent(row.public_slug),
    slug: row.public_slug,
    community: row.community_slug ? { name: row.community_name, slug: row.community_slug } : null,
    ...(row.show_attendee_count ? { attendee_count: row.attendee_count } : {}),
  };
}

export function toFeedCommunityDto(row: FeedCommunityRow) {
  return {
    type: 'community' as const,
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
    member_count: row.member_count,
  };
}

/** Pessoa: só nome e imagens. Nunca email, telefone ou data de nascimento. */
export function toFeedPersonDto(row: FeedPersonRow) {
  return {
    type: 'person' as const,
    id: row.id,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    cover_url: row.cover_url,
  };
}

/* ────────────────────────────── Serviço ─────────────────────────────── */

export const socialService = {
  async feed(input: { type: FeedType; q?: string; category?: string; cursor?: string }) {
    const offset = decodeCursor(input.cursor);
    // Pede mais um para saber se há página seguinte.
    const limit = FEED_PAGE_SIZE + 1;
    let items: unknown[];
    if (input.type === 'communities') {
      items = (await socialRepository.feedCommunities({ q: input.q, offset, limit })).map(toFeedCommunityDto);
      // Bloco 13: instituições públicas aparecem como cartões no topo da
      // primeira página do separador "Comunidades" (sem novo tipo de pesquisa).
      if (offset === 0) {
        const institutions = await institutionRepository.listPublic(6, 0, input.q);
        const hasMore = items.length > FEED_PAGE_SIZE;
        const cards = institutions.map((row) => ({
          type: 'institution' as const,
          id: row.id,
          name: row.name,
          slug: row.slug,
          description: row.description,
          avatar_url: row.avatar_url,
          cover_url: row.cover_url,
          community_count: row.community_count,
        }));
        return {
          items: [...cards, ...items.slice(0, FEED_PAGE_SIZE)],
          next_cursor: hasMore ? encodeCursor(offset + FEED_PAGE_SIZE) : null,
        };
      }
    } else if (input.type === 'people') {
      items = (await socialRepository.feedPeople({ q: input.q, offset, limit })).map(toFeedPersonDto);
    } else {
      items = (await socialRepository.feedEvents({ q: input.q, category: input.category, offset, limit })).map(
        toFeedEventDto
      );
    }
    const hasMore = items.length > FEED_PAGE_SIZE;
    return {
      items: items.slice(0, FEED_PAGE_SIZE),
      next_cursor: hasMore ? encodeCursor(offset + FEED_PAGE_SIZE) : null,
    };
  },

  async search(q: string) {
    const term = q.trim();
    if (term.length < 2) return { events: [], communities: [], people: [] };
    const [events, communities, people] = await Promise.all([
      socialRepository.feedEvents({ q: term, offset: 0, limit: SEARCH_GROUP_LIMIT }),
      socialRepository.feedCommunities({ q: term, offset: 0, limit: SEARCH_GROUP_LIMIT }),
      socialRepository.feedPeople({ q: term, offset: 0, limit: SEARCH_GROUP_LIMIT }),
    ]);
    return {
      events: events.map(toFeedEventDto),
      communities: communities.map(toFeedCommunityDto),
      people: people.map(toFeedPersonDto),
    };
  },

  /** Versão limitada para visitantes sem conta: nome e imagens. */
  async publicProfile(id: string) {
    const person = await socialRepository.findPublicPerson(id);
    if (!person) throw new NotFoundError('Perfil não encontrado.', 'profile_not_found');
    return toFeedPersonDto(person);
  },

  /** Perfil completo para quem tem conta (só perfis públicos, ou o próprio). */
  async profile(id: string, viewerId: string) {
    const person = await socialRepository.findVisiblePerson(id, viewerId);
    if (!person) throw new NotFoundError('Perfil não encontrado.', 'profile_not_found');
    const isSelf = id === viewerId;
    const [events, communities, friendCount, mutualFriends, mutualCommunities, friendship] = await Promise.all([
      socialRepository.hostedEvents(id, false, 0, 12),
      socialRepository.publicCommunitiesOf(id),
      socialRepository.friendCount(id),
      isSelf ? Promise.resolve({ total: 0, preview: [] }) : socialRepository.mutualFriends(id, viewerId),
      isSelf ? Promise.resolve([]) : socialRepository.mutualCommunities(id, viewerId),
      isSelf ? Promise.resolve(null) : socialRepository.findFriendship(id, viewerId),
    ]);
    return {
      ...toFeedPersonDto(person),
      is_self: isSelf,
      friend_count: friendCount,
      events: events.map(toFeedEventDto),
      communities: communities.map(toFeedCommunityDto),
      mutual_friends: { total: mutualFriends.total, preview: mutualFriends.preview.map(toFeedPersonDto) },
      mutual_communities: mutualCommunities.map(toFeedCommunityDto),
      friendship: friendship
        ? {
            id: friendship.id,
            status: friendship.status === 'rejected' ? 'none' : friendship.status,
            direction: friendship.requester_id === viewerId ? 'outgoing' : 'incoming',
          }
        : { id: null, status: 'none', direction: null },
    };
  },

  async profileEvents(id: string, viewerId: string, past: boolean, cursor?: string) {
    const person = await socialRepository.findVisiblePerson(id, viewerId);
    if (!person) throw new NotFoundError('Perfil não encontrado.', 'profile_not_found');
    const offset = decodeCursor(cursor);
    const rows = await socialRepository.hostedEvents(id, past, offset, FEED_PAGE_SIZE + 1);
    return {
      items: rows.slice(0, FEED_PAGE_SIZE).map(toFeedEventDto),
      next_cursor: rows.length > FEED_PAGE_SIZE ? encodeCursor(offset + FEED_PAGE_SIZE) : null,
    };
  },

  /** Comunidade pública para visitantes: sem lista de membros. */
  async publicCommunity(slug: string) {
    const community = await socialRepository.findPublicCommunity(slug);
    if (!community) throw new NotFoundError('Comunidade não encontrada.', 'community_not_found');
    const upcoming = await socialRepository.communityEvents(community.id, false, 0, 12);
    return { ...toFeedCommunityDto(community), events: upcoming.map(toFeedEventDto) };
  },

  async communityEvents(slug: string, past: boolean, cursor?: string) {
    const community = await socialRepository.findPublicCommunity(slug);
    if (!community) throw new NotFoundError('Comunidade não encontrada.', 'community_not_found');
    const offset = decodeCursor(cursor);
    const rows = await socialRepository.communityEvents(community.id, past, offset, FEED_PAGE_SIZE + 1);
    return {
      items: rows.slice(0, FEED_PAGE_SIZE).map(toFeedEventDto),
      next_cursor: rows.length > FEED_PAGE_SIZE ? encodeCursor(offset + FEED_PAGE_SIZE) : null,
    };
  },

  /* ─────────────────────────────── Amizades ─────────────────────────────── */

  async requestFriend(viewer: { hostId: string; name: string }, targetId: string): Promise<string> {
    if (targetId === viewer.hostId) {
      throw new ValidationError('Não pode adicionar-se a si próprio.', { host_id: ['Pessoa inválida.'] });
    }
    const target = await socialRepository.findPublicPerson(targetId);
    if (!target) throw new NotFoundError('Perfil não encontrado.', 'profile_not_found');

    const existing = await socialRepository.findFriendship(viewer.hostId, targetId);
    if (existing?.status === 'accepted') {
      throw new ConflictError('Já são amigos.', 'friendship_exists');
    }
    if (existing?.status === 'blocked') {
      throw new NotFoundError('Perfil não encontrado.', 'profile_not_found');
    }
    if (existing?.status === 'pending') {
      // Pedido em sentido contrário: aceitar em vez de duplicar.
      if (existing.addressee_id === viewer.hostId) {
        await this.respond(viewer, existing.id, true);
        return existing.id;
      }
      throw new ConflictError('O pedido já foi enviado.', 'friendship_pending');
    }
    if ((await socialRepository.requestsSentToday(viewer.hostId)) >= FRIEND_REQUESTS_PER_DAY) {
      throw new TooManyRequestsError('Atingiu o limite de pedidos de amizade por hoje.', 'friend_request_limit');
    }

    const id = await socialRepository.upsertRequest(viewer.hostId, targetId);
    await notificationRepository.createForHost({
      hostId: targetId,
      eventId: null,
      kind: 'friend_request',
      title: 'Novo pedido de amizade',
      body: `${viewer.name} quer ser seu amigo.`,
      metadata: { friendship_id: id, from_host_id: viewer.hostId },
      dedupeKey: `friend_request:${id}:${new Date().toISOString().slice(0, 10)}`,
    });
    return id;
  },

  async respond(viewer: { hostId: string; name: string }, friendshipId: string, accept: boolean): Promise<void> {
    const friendship = await socialRepository.findFriendshipById(friendshipId);
    if (!friendship || friendship.addressee_id !== viewer.hostId || friendship.status !== 'pending') {
      throw new NotFoundError('Pedido não encontrado.', 'friendship_not_found');
    }
    await socialRepository.respond(friendship.id, accept ? 'accepted' : 'rejected');
    if (accept) {
      await notificationRepository.createForHost({
        hostId: friendship.requester_id,
        eventId: null,
        kind: 'friend_accepted',
        title: 'Pedido de amizade aceite',
        body: `${viewer.name} aceitou o seu pedido de amizade.`,
        metadata: { friendship_id: friendship.id, from_host_id: viewer.hostId },
        dedupeKey: `friend_accepted:${friendship.id}`,
      });
    }
  },

  /** Remover amigo ou cancelar um pedido enviado. */
  async remove(viewerId: string, friendshipId: string): Promise<void> {
    const friendship = await socialRepository.findFriendshipById(friendshipId);
    if (
      !friendship ||
      (friendship.requester_id !== viewerId && friendship.addressee_id !== viewerId) ||
      friendship.status === 'blocked'
    ) {
      throw new NotFoundError('Amizade não encontrada.', 'friendship_not_found');
    }
    await socialRepository.remove(friendship.id);
  },

  async list(viewerId: string) {
    const rows = await socialRepository.listForHost(viewerId);
    const toItem = (row: (typeof rows)[number]) => ({
      id: row.id,
      person: { id: row.other_id, display_name: row.display_name, avatar_url: row.avatar_url },
      created_at: row.created_at.toISOString(),
    });
    return {
      friends: rows.filter((row) => row.status === 'accepted').map(toItem),
      incoming: rows.filter((row) => row.status === 'pending' && row.direction === 'incoming').map(toItem),
      outgoing: rows.filter((row) => row.status === 'pending' && row.direction === 'outgoing').map(toItem),
    };
  },
};

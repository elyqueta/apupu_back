import { invitationRepository } from '../repositories/invitation.repository';
import { GuestInvitationsQuery } from '../schemas/host.schemas';
import { AccountInvitation } from '../types/invitation.types';
import { PaginationMeta } from '../types/pagination.types';
import { buildPaginationMeta, toPageParams } from '../utils/pagination.util';

export interface GuestInvitationListResult {
  items: AccountInvitation[];
  pagination: PaginationMeta;
}

/**
 * "Meus convites": convites dirigidos ao email da conta autenticada.
 *
 * O email vem sempre da sessão. A verificação do email é feita por
 * middleware antes de chegar aqui, para que uma conta por verificar
 * não consiga reclamar convites alheios.
 */
export const guestInvitationService = {
  async listMine(
    email: string,
    query: GuestInvitationsQuery
  ): Promise<GuestInvitationListResult> {
    const page = toPageParams(query.page, query.page_size);

    const { items, total } = await invitationRepository.listForAccountEmail({
      email,
      sort: query.sort,
      order: query.order,
      offset: page.offset,
      limit: page.limit,
    });

    return {
      items,
      pagination: buildPaginationMeta(total, page.page, page.pageSize),
    };
  },
};

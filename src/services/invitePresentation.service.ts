import { query } from '../database/pool';
import { templateRepository } from '../repositories/template.repository';
import { Event } from '../types/event.types';
import { parseManifest, TemplateManifest } from '../types/templateManifest';

/**
 * Bloco 14 — dados extra da apresentação pública (convite e link aberto):
 * o manifesto do template, os organizadores e a comunidade.
 *
 * Hierarquia: o convidado vê o responsável e os gestores da comunidade
 * (ou o anfitrião, num evento pessoal). Membros nunca aparecem aqui.
 * Contactos: só o email da conta e o telefone do perfil, quando preenchido.
 */
export interface OrganizerDto {
  display_name: string;
  avatar_url: string | null;
  role: 'owner' | 'manager';
  email: string | null;
  phone: string | null;
}

export interface PresentationExtras {
  template: { slug: string; name: string; manifest: TemplateManifest } | null;
  organizers: OrganizerDto[];
  community: { name: string; slug: string; avatar_url: string | null; visibility: string } | null;
}

interface OrganizerRow {
  display_name: string | null;
  avatar_url: string | null;
  role: 'owner' | 'manager';
  email: string | null;
  phone: string | null;
}

const MAX_ORGANIZERS = 12;

export const invitePresentationService = {
  async extras(event: Event): Promise<PresentationExtras> {
    const [template, organizers, community] = await Promise.all([
      event.templateId ? templateRepository.findById(event.templateId) : Promise.resolve(null),
      this.organizers(event),
      event.communityId ? this.community(event.communityId) : Promise.resolve(null),
    ]);
    return {
      template: template
        ? { slug: template.slug, name: template.name, manifest: parseManifest(template.manifest) }
        : null,
      organizers,
      community,
    };
  },

  async organizers(event: Event): Promise<OrganizerDto[]> {
    if (!event.communityId) {
      const result = await query<OrganizerRow>(
        `SELECT COALESCE(p.display_name, e.host_name) AS display_name, p.avatar_url,
                'owner' AS role, e.host_email AS email, p.phone
           FROM events e
           LEFT JOIN hosts h ON h.email = e.host_email AND h.status = 'active'
           LEFT JOIN host_profiles p ON p.host_id = h.id
          WHERE e.id = $1
          LIMIT 1`,
        [event.id]
      );
      return result.rows.map(toOrganizer);
    }
    // Responsável primeiro, depois gestores; só membros activos com conta.
    const result = await query<OrganizerRow>(
      `SELECT COALESCE(p.display_name, m.display_name, split_part(h.email, '@', 1)) AS display_name,
              p.avatar_url, m.role, h.email, p.phone
         FROM community_members m
         JOIN hosts h ON h.id = m.host_id AND h.status = 'active'
         LEFT JOIN host_profiles p ON p.host_id = h.id
        WHERE m.community_id = $1
          AND m.status = 'active'
          AND m.role IN ('owner', 'manager')
        ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.joined_at NULLS LAST
        LIMIT ${MAX_ORGANIZERS}`,
      [event.communityId]
    );
    return result.rows.map(toOrganizer);
  },

  async community(communityId: string): Promise<PresentationExtras['community']> {
    const result = await query<{ name: string; slug: string; avatar_url: string | null; visibility: string }>(
      `SELECT name, slug, avatar_url, visibility FROM communities WHERE id = $1 AND deleted_at IS NULL`,
      [communityId]
    );
    return result.rows[0] ?? null;
  },
};

function toOrganizer(row: OrganizerRow): OrganizerDto {
  return {
    display_name: row.display_name ?? '',
    avatar_url: row.avatar_url,
    role: row.role,
    email: row.email,
    phone: row.phone && row.phone.trim() ? row.phone : null,
  };
}

import { env } from '../../config/env';
import {
  AdminProfileEvent,
  AdminProfileTeam,
  AdminReportHost,
} from '../../repositories/adminProfile.repository';
import { AdminUserListItem } from '../../repositories/host.repository';
import {
  eventStatusLabel,
  exportDateStamp,
  formatCalendarDate,
  formatExportDateTime,
  formatReportCount,
  reportDocumentCode,
  slugify,
} from '../../utils/exportFormat.util';
import {
  drawHighlightBlock,
  drawSectionTitle,
  drawTable,
  drawTitle,
  PdfContext,
  renderPdf,
  TableCell,
  TableColumn,
} from './pdfLayout';
import { PDF_COLORS, mm } from './pdfTheme';

/** Dados de um perfil para o PDF do painel admin (Bloco 8). */
export interface AdminProfilePdfData {
  user: AdminUserListItem;
  events: AdminProfileEvent[];
  teams: AdminProfileTeam[];
}

export interface AdminPdfOptions {
  /** Desactiva o download de imagens nos testes (sem rede). */
  includeImages?: boolean;
}

/** Nomes de ficheiro partilhados pela API e pelo agendador semanal. */
export function adminProfilePdfFilename(
  user: AdminUserListItem,
  generatedAt: Date
): string {
  const name = slugify(user.display_name || user.email.split('@')[0] || 'perfil');
  return `conto-contigo_perfil_${name}_${exportDateStamp(generatedAt)}.pdf`;
}

export function adminWeeklyPdfFilename(generatedAt: Date): string {
  return `conto-contigo_relatorio-semanal_${exportDateStamp(generatedAt)}.pdf`;
}

/**
 * Só são embebidas imagens do Cloudinary configurado. `avatar_url` e
 * `cover_url` podem ser definidos pelo utilizador: aceitar URLs
 * arbitrárias transformaria a geração do PDF num vector de SSRF.
 */
function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return null;
    const cloud = env.CLOUDINARY_CLOUD_NAME?.trim();
    if (!cloud || url.pathname.split('/')[2] !== cloud) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(env.ADMIN_WEEKLY_REPORT_IMAGE_TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png|webp|gif)$/.test(contentType)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength > 0 && bytes.byteLength <= 8 * 1024 * 1024 ? bytes : null;
  } catch {
    return null;
  }
}

async function drawImages(
  ctx: PdfContext,
  y: number,
  coverUrl: string | null | undefined,
  avatarUrl: string | null | undefined,
  includeImages: boolean
): Promise<number> {
  const coverWidth = ctx.width;
  const coverHeight = mm(30);

  ctx.doc
    .roundedRect(ctx.left, y, coverWidth, coverHeight, mm(2))
    .fillColor(PDF_COLORS.stripe)
    .fill();

  if (includeImages) {
    const cover = safeImageUrl(coverUrl);
    if (cover) {
      const image = await fetchImage(cover);
      if (image) {
        try {
          ctx.doc.image(image, ctx.left, y, { cover: [coverWidth, coverHeight] });
        } catch {
          // Imagem inválida: mantém-se o fundo.
        }
      }
    }
  }

  const avatarY = y + coverHeight - mm(9);
  const avatarSize = mm(18);
  ctx.doc
    .circle(ctx.left + mm(11), avatarY, avatarSize / 2)
    .fillColor(PDF_COLORS.white)
    .fill();

  if (includeImages) {
    const avatar = safeImageUrl(avatarUrl);
    if (avatar) {
      const image = await fetchImage(avatar);
      if (image) {
        try {
          ctx.doc.image(image, ctx.left + mm(11) - avatarSize / 2, avatarY - avatarSize / 2, {
            fit: [avatarSize, avatarSize],
          });
        } catch {
          // Imagem inválida: mantém-se o círculo branco.
        }
      }
    }
  }

  return y + coverHeight + mm(14);
}

function drawDetails(ctx: PdfContext, y: number, data: AdminProfilePdfData): number {
  const { user } = data;
  const rows: TableCell[][] = [
    ['Nome', user.display_name || '—'],
    ['Email', user.email],
    ['Telefone', user.phone || '—'],
    ['Papel', user.is_super_admin ? 'Super administrador' : 'Anfitrião'],
    ['Estado', user.status === 'active' ? 'Ativo' : user.status === 'suspended' ? 'Suspenso' : 'Eliminado'],
    ['Data de registo', formatExportDateTime(user.created_at) || '—'],
    ['Data de nascimento', formatCalendarDate(user.birth_date || '') || '—'],
    ['Idioma / fuso', `${user.locale} · ${user.timezone}`],
    ['Email verificado', user.email_verified_at ? 'Sim' : 'Não'],
  ];

  return drawTable(
    ctx,
    y,
    [
      { label: 'Dado', weight: 0.3 },
      { label: 'Valor', weight: 0.7 },
    ],
    rows
  );
}

function eventRows(events: AdminProfileEvent[]): TableCell[][] {
  return events.map((event) => [
    event.title,
    eventStatusLabel(event.status),
    formatExportDateTime(event.starts_at) || '—',
    formatReportCount(event.guest_count),
  ]);
}

function teamRows(teams: AdminProfileTeam[]): TableCell[][] {
  return teams.map((team) => [
    team.name,
    team.event_title || '—',
    formatReportCount(team.member_count),
  ]);
}

const EVENT_COLUMNS: TableColumn[] = [
  { label: 'Evento', weight: 0.42 },
  { label: 'Estado', weight: 0.18 },
  { label: 'Data', weight: 0.27 },
  { label: 'Convidados', weight: 0.13, align: 'right' },
];

const TEAM_COLUMNS: TableColumn[] = [
  { label: 'Equipa', weight: 0.38 },
  { label: 'Evento', weight: 0.42 },
  { label: 'Membros', weight: 0.2, align: 'right' },
];

/** PDF de um único perfil, com o mesmo conteúdo do detalhe do painel. */
export async function renderAdminProfilePdf(
  data: AdminProfilePdfData,
  generatedAt: Date,
  options: AdminPdfOptions = {}
): Promise<Buffer> {
  const meta = {
    documentType: 'Perfil de utilizador',
    documentCode: reportDocumentCode(`perfil:${data.user.id}:${generatedAt.toISOString()}`, generatedAt),
    generatedAt,
    title: `Conto Contigo — Perfil de ${data.user.display_name || data.user.email}`,
    subject: 'Relatório individual de utilizador do painel administrativo',
  };

  return renderPdf(meta, async (ctx) => {
    let y = drawTitle(ctx, data.user.display_name || data.user.email, [
      'Perfil da conta, eventos e equipas associadas.',
    ]);

    y = await drawImages(
      ctx,
      y,
      data.user.cover_url,
      data.user.avatar_url,
      options.includeImages !== false
    );

    y = drawHighlightBlock(ctx, y, [
      { label: 'Eventos', value: formatReportCount(data.events.length) },
      { label: 'Equipas', value: formatReportCount(data.teams.length) },
      {
        label: 'Convidados',
        value: formatReportCount(data.events.reduce((total, event) => total + event.guest_count, 0)),
      },
    ]);

    y = drawSectionTitle(ctx, y, 'Dados da conta');
    y = drawDetails(ctx, y, data);

    if (y > ctx.contentBottom - mm(30)) {
      ctx.doc.addPage();
      y = ctx.contentTop;
    }
    y = drawSectionTitle(ctx, y, 'Eventos');
    y = drawTable(ctx, y, EVENT_COLUMNS, eventRows(data.events), {
      emptyMessage: 'Este utilizador ainda não criou eventos.',
    });

    if (y > ctx.contentBottom - mm(30)) {
      ctx.doc.addPage();
      y = ctx.contentTop;
    }
    y = drawSectionTitle(ctx, y, 'Equipas associadas');
    drawTable(ctx, y, TEAM_COLUMNS, teamRows(data.teams), {
      emptyMessage: 'Este utilizador não tem equipas associadas.',
    });
  });
}

/** PDF global semanal: resumo agregado e uma página por perfil. */
export async function renderAdminAllProfilesPdf(
  users: AdminReportHost[],
  generatedAt: Date,
  options: AdminPdfOptions = {}
): Promise<Buffer> {
  const meta = {
    documentType: 'Relatório semanal de perfis',
    documentCode: reportDocumentCode(`relatorio-semanal:${generatedAt.toISOString()}`, generatedAt),
    generatedAt,
    title: 'Conto Contigo — Relatório semanal de perfis',
    subject: 'Resumo de todas as contas, eventos, equipas e convites da plataforma',
  };

  const totals = users.reduce(
    (acc, user) => ({
      events: acc.events + user.events_count,
      teams: acc.teams + user.teams_count,
      invitations: acc.invitations + user.invitations_count,
    }),
    { events: 0, teams: 0, invitations: 0 }
  );

  return renderPdf(meta, async (ctx) => {
    let y = drawTitle(ctx, 'Relatório semanal de perfis', [
      'Visão global das contas da plataforma e da respetiva actividade.',
    ]);

    y = drawHighlightBlock(ctx, y, [
      { label: 'Perfis', value: formatReportCount(users.length) },
      { label: 'Eventos', value: formatReportCount(totals.events) },
      { label: 'Equipas', value: formatReportCount(totals.teams) },
      { label: 'Convites', value: formatReportCount(totals.invitations) },
    ]);

    y = drawSectionTitle(ctx, y, 'Contas');

    const rows: TableCell[][] = users.map((user) => [
      user.display_name || user.email,
      user.email,
      formatReportCount(user.events_count),
      formatReportCount(user.teams_count),
      formatReportCount(user.invitations_count),
    ]);

    drawTable(
      ctx,
      y,
      [
        { label: 'Nome', weight: 0.26 },
        { label: 'Email', weight: 0.34 },
        { label: 'Eventos', weight: 0.13, align: 'right' },
        { label: 'Equipas', weight: 0.13, align: 'right' },
        { label: 'Convites', weight: 0.14, align: 'right' },
      ],
      rows,
      { emptyMessage: 'Ainda não existem contas.' }
    );

    if (options.includeImages === false) return;

    // Cada perfil começa numa página nova, mantendo o mesmo bloco de
    // capa/avatar e os dados usados no detalhe do painel.
    for (const user of users) {
      ctx.doc.addPage();
      let cursor = drawSectionTitle(ctx, ctx.contentTop, user.display_name || user.email);
      cursor = await drawImages(ctx, cursor, user.cover_url, user.avatar_url, true);

      cursor = drawHighlightBlock(ctx, cursor, [
        { label: 'Eventos', value: formatReportCount(user.events_count) },
        { label: 'Equipas', value: formatReportCount(user.teams_count) },
        { label: 'Convites', value: formatReportCount(user.invitations_count) },
      ]);

      const details: AdminProfilePdfData = {
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          status: user.status as AdminUserListItem['status'],
          is_super_admin: user.is_super_admin,
          email_verified_at: null,
          created_at: user.created_at,
          avatar_url: user.avatar_url,
          cover_url: user.cover_url,
          phone: user.phone,
          birth_date: null,
          locale: user.locale,
          timezone: user.timezone,
          profile_complete: true,
        },
        events: [],
        teams: [],
      };
      drawDetails(ctx, cursor, details);
    }
  });
}

import { z } from 'zod';

/**
 * Bloco 14 — manifesto de template (v1). O convite público e o PDF lêem o
 * mesmo manifesto. Fontes restritas às já empacotadas/permitidas, sempre
 * com fallback.
 */
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const TEMPLATE_FONTS = ['sans', 'serif', 'cap', 'script', 'condensed', 'anton'] as const;
export const OPEN_STYLES = ['none', 'envelope', 'curtain', 'fade', 'fold'] as const;
export const COVER_MODES = ['hero', 'framed', 'none'] as const;
export const LAYOUT_BLOCKS = ['title', 'host', 'datetime', 'location', 'deadline', 'message'] as const;
export const QR_POSITIONS = ['bottom-center', 'bottom-right', 'bottom-left'] as const;
/** Bloco 15B: apresentação da miniatura; não altera o documento de blocos. */
export const TEMPLATE_ORIENTATIONS = [
  'strip',
  'card45',
  'a5',
  'a4',
  'landscape',
  'story',
] as const;

const templateBlockSchema = z.object({ id: z.string(), type: z.string() }).passthrough();
const templateDocumentSchema = z
  .object({ version: z.literal(2), blocks: z.array(templateBlockSchema) })
  .passthrough();

export const templateManifestSchema = z
  .object({
    version: z.literal(1),
    palette: z.object({ bg: hex, surface: hex, ink: hex, accent: hex, muted: hex }).strict(),
    fonts: z.object({ display: z.enum(TEMPLATE_FONTS), body: z.enum(TEMPLATE_FONTS) }).strict(),
    ornaments: z
      .object({
        frame: z.string().max(40),
        corners: z.string().max(40),
        divider: z.string().max(40),
      })
      .strict(),
    layout: z
      .object({
        align: z.enum(['left', 'center']),
        blocks: z.array(z.enum(LAYOUT_BLOCKS)).min(1).max(LAYOUT_BLOCKS.length),
      })
      .strict(),
    cover: z.enum(COVER_MODES),
    open_style: z.enum(OPEN_STYLES),
    pdf: z
      .object({
        frame: z.enum(['none', 'single', 'double']),
        qr_position: z.enum(QR_POSITIONS),
        show_ornaments: z.boolean(),
        qr_label: z.string().max(40).optional(),
        qr_destination: z.enum(['event', 'invite', 'custom']).optional(),
        qr_custom_url: z.string().max(500).optional(),
        // Bloco 15: logo e QR configuráveis
        logo_url: z.string().max(2048).optional(),
        logo_public_id: z.string().max(512).optional(),
        logo_shape: z.enum(['circle', 'original']).optional(),
        logo_size: z.enum(['sm', 'md', 'lg']).optional(),
        qr_mode: z.enum(['invite', 'event', 'whatsapp', 'custom', 'image']).optional(),
        qr_whatsapp_phone: z.string().max(32).optional(),
        qr_whatsapp_message: z.string().max(500).optional(),
        qr_image_url: z.string().max(2048).optional(),
        qr_image_public_id: z.string().max(512).optional(),
        qr_icon: z.enum(['none', 'whatsapp', 'brand']).optional(),
        qr_size: z.enum(['md', 'lg']).optional(),
      })
      .strict(),
    /** Bloco 15, Passo 2: documento de blocos (editor/convite/PDF). */
    document: templateDocumentSchema.optional(),
    /** Bloco 15B: forma da miniatura/pré-visualização. */
    orientation: z.enum(TEMPLATE_ORIENTATIONS).optional(),
    /** Bloco 15B: conteúdo de exemplo, sempre texto simples. */
    previewData: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export const DEFAULT_MANIFEST: TemplateManifest = {
  version: 1,
  palette: { bg: '#FFFFFF', surface: '#FFFFFF', ink: '#1F2937', accent: '#7C5CFF', muted: '#6B7280' },
  fonts: { display: 'sans', body: 'sans' },
  ornaments: { frame: 'none', corners: 'none', divider: 'line' },
  layout: { align: 'left', blocks: ['title', 'host', 'datetime', 'location', 'deadline', 'message'] },
  cover: 'hero',
  open_style: 'fade',
  pdf: { frame: 'single', qr_position: 'bottom-right', show_ornaments: false },
};

/** Manifesto inválido ou vazio cai no neutro (nunca parte o convite). */
export function parseManifest(raw: unknown): TemplateManifest {
  const parsed = templateManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_MANIFEST;
}

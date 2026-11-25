import { query } from '../database/pool';
import { EventTemplate } from '../types/template.types';

interface TemplateRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  preview_image_url: string | null;
  supported_fields: string[];
  themes: Array<{ mode: string; palette: string }>;
  is_active: boolean;
  sort_order: number;
  manifest: unknown;
  kind?: 'system' | 'user';
  created_at: Date;
  updated_at: Date;
}

function toTemplate(row: TemplateRow): EventTemplate {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    previewImageUrl: row.preview_image_url,
    supportedFields: row.supported_fields,
    themes: row.themes,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    manifest: row.manifest,
    kind: row.kind ?? 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = `
  id, slug, name, description, preview_image_url, supported_fields, themes,
  is_active, sort_order, manifest, kind, created_at, updated_at
`;

export const templateRepository = {
  async listActive(): Promise<EventTemplate[]> {
    const result = await query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM event_templates
        WHERE is_active = true
        ORDER BY sort_order ASC, name ASC`
    );
    return result.rows.map(toTemplate);
  },

  async findById(id: string): Promise<EventTemplate | null> {
    const result = await query<TemplateRow>(
      `SELECT ${SELECT_COLUMNS} FROM event_templates WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? toTemplate(row) : null;
  },
};

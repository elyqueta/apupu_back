/** Tipos do domínio de templates de convite. */

export interface EventTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  previewImageUrl: string | null;
  /** Campos do evento que este template sabe apresentar. */
  supportedFields: string[];
  /** Temas/paletas permitidos, definidos pelo template. */
  themes: Array<{ mode: string; palette: string }>;
  isActive: boolean;
  /** Bloco 14: manifesto v1 (jsonb, validado ao ler). */
  manifest: unknown;
  /** Bloco 15: system = oficial da plataforma, user = criado pelo utilizador. */
  kind: 'system' | 'user';
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

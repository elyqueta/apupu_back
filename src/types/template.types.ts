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
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tipos do catálogo de mensagens.
 *
 * O catálogo é a única fonte de texto visível ao utilizador. O e-mail,
 * a versão em texto simples, a notificação push e o SMS são todos
 * derivados das mesmas entradas — nunca há copy espalhada pelos
 * serviços.
 */

/** Códigos do catálogo do Prompt 2. */
export const EMAIL_TEMPLATE_CODES = [
  'boas_vindas',
  'verificacao_codigo',
  'recuperar_senha',
  'convite_recebido',
  'presenca_confirmada',
  'lembrete_24h',
  'lembrete_2h',
  'evento_alterado',
  'evento_cancelado',
  // Mensagens operacionais que já existiam na outbox.
  'lembrete',
  'manage_link',
  'manager_invite',
  'email_verification',
  'profile_reminder',
  'decline_notification',
  'invitation_removed',
  // Fase 3 — equipas e tarefas.
  // Nomes do catálogo em português, tal como o pedido.
  'equipa_convite',
  'equipa_adicionado',
  'equipa_papel_alterado',
  'tarefa_atribuida',
  'tarefa_concluida',
  'tarefa_reatribuida',
] as const;

export type EmailTemplateCode = (typeof EMAIL_TEMPLATE_CODES)[number];

/**
 * Variáveis aceites pelo catálogo.
 *
 * Todas são opcionais para que o mesmo tipo sirva mensagens de conta e
 * mensagens de evento. O catálogo aplica valores por omissão seguros.
 */
export interface EmailVars {
  /** Nome de quem recebe. */
  nome?: string;
  /** Nome do anfitrião. */
  anfitriao?: string;
  /** Nome do convidado. */
  convidado?: string;
  /** Nome do evento. */
  evento?: string;
  /** Data já formatada, ex.: "sáb, 21 nov 2026". */
  data?: string;
  /** Hora já formatada, ex.: "15:00". */
  hora?: string;
  /** Local ou ligação online já formatados. */
  local?: string;
  /** Código de confirmação (OTP). */
  codigo?: string;
  /** Validade legível do código/ligação, ex.: "10 minutos". */
  expiraEm?: string;
  /** Ligação principal da mensagem. */
  url?: string;
  /** Dias que faltam para o evento (lembretes genéricos). */
  dias?: number;
  /** `true` quando a presença do convidado já está confirmada. */
  confirmado?: boolean;
  /** `true` quando o evento é online. */
  online?: boolean;
  /** Código de vestuário, quando definido. */
  vestuario?: string;
  /** `true` quando o evento aceita contribuições. */
  contribuicao?: boolean;
  /** Informação adicional curta (ex.: e-mail do convidado). */
  detalhe?: string;
  /** Nome da equipa (Fase 3). */
  equipa?: string;
  /** Título da tarefa (Fase 3). */
  tarefa?: string;
  /** Nome do responsável actual (Fase 3). */
  responsavel?: string;
  /** Nome do responsável anterior, em reatribuições (Fase 3). */
  anterior?: string;
  /** Nome de quem executou a acção (Fase 3). */
  autor?: string;
  /** Papel na equipa: "gestor" ou "membro" (Fase 3). */
  papel?: string;
  /** Prazo já formatado, ex.: "31 jan 2030" (Fase 3). */
  prazo?: string;
}

export type EmailTone = 'default' | 'danger';

/** Caixa de detalhes do evento. */
export interface EmailDetails {
  name: string;
  date?: string;
  time?: string;
  location?: string;
}

/** Conteúdo de um e-mail, independente do canal de entrega. */
export interface EmailContent {
  subject: string;
  preheader: string;
  title: string;
  /** Sem nome, a saudação é apenas "Olá." */
  greetingName?: string;
  paragraphs: string[];
  details?: EmailDetails;
  /** Código em destaque (substitui o botão no caso do OTP). */
  code?: string;
  cta?: { label: string; url: string };
  /** Completa a frase "Recebeste este e-mail porque ...". */
  reason: string;
  tone?: EmailTone;
}

/** Mensagem curta para in-app/push. */
export interface PushMessage {
  title: string;
  body: string;
}

/** Entrada do catálogo: e-mail, push e SMS a partir das mesmas variáveis. */
export interface CatalogEntry {
  code: EmailTemplateCode;
  email: (vars: EmailVars) => EmailContent;
  push: (vars: EmailVars) => PushMessage;
  sms: (vars: EmailVars) => string;
}

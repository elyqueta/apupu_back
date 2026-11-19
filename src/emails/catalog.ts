import {
  CatalogEntry,
  EmailContent,
  EmailDetails,
  EmailTemplateCode,
  EmailVars,
  PushMessage,
} from './types';

const DEFAULT_EVENT = 'o evento';
const DEFAULT_HOST = 'O anfitrião';
const DEFAULT_GUEST = 'um convidado';

/** Normaliza espaços e corta sem partir palavras a meio. */
function short(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;

  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;

  return `${base.trimEnd()}…`;
}

function eventName(vars: EmailVars): string {
  return vars.evento?.trim() || DEFAULT_EVENT;
}

function hostName(vars: EmailVars): string {
  return vars.anfitriao?.trim() || DEFAULT_HOST;
}

function guestName(vars: EmailVars): string {
  return vars.convidado?.trim() || DEFAULT_GUEST;
}

function recipientName(vars: EmailVars): string | undefined {
  return vars.nome?.trim() || undefined;
}

function eventDetails(vars: EmailVars): EmailDetails | undefined {
  if (!vars.evento) return undefined;

  return {
    name: eventName(vars),
    date: vars.data,
    time: vars.hora,
    location: vars.local,
  };
}

function pushMessage(title: string, body: string): PushMessage {
  return { title: short(title, 45), body: short(body, 120) };
}

function smsMessage(text: string, url?: string): string {
  const suffix = url ? ` ${url}` : '';
  const available = 160 - suffix.length;

  if (available <= 0) {
    return suffix.trim().slice(0, 160);
  }

  return `${short(text, available)}${suffix}`.trim();
}

function reminderParagraphs(vars: EmailVars): string[] {
  const paragraphs = vars.confirmado
    ? ['A tua presença está confirmada. Aqui ficam os detalhes do evento.']
    : ['Ainda não respondeste. Confirma ou atualiza a tua resposta.'];

  if (vars.vestuario) {
    paragraphs.push(`Código de vestuário: ${vars.vestuario}.`);
  }

  return paragraphs;
}

function reminderCta(vars: EmailVars, label: string): EmailContent['cta'] {
  return vars.url ? { label, url: vars.url } : undefined;
}

export const catalog: Record<EmailTemplateCode, CatalogEntry> = {
  boas_vindas: {
    code: 'boas_vindas',
    email: (vars) => ({
      subject: short('Bem-vindo ao Conto Contigo', 50),
      preheader: short('A tua conta está pronta. Cria o teu primeiro evento.', 90),
      title: 'Bem-vindo ao Conto Contigo',
      greetingName: recipientName(vars),
      paragraphs: [
        'A tua conta está criada e o teu e-mail já está confirmado.',
        'Cria o teu primeiro evento, convida quem queres e acompanha as respostas num só lugar.',
      ],
      cta: vars.url ? { label: 'Criar o meu primeiro evento', url: vars.url } : undefined,
      reason: 'criaste uma conta no Conto Contigo',
    }),
    push: () =>
      pushMessage('Bem-vindo ao Conto Contigo', 'Cria o teu primeiro evento e convida quem queres.'),
    sms: (vars) => smsMessage('Conto Contigo: bem-vindo! Cria o teu primeiro evento:', vars.url),
  },

  verificacao_codigo: {
    code: 'verificacao_codigo',
    email: (vars) => ({
      subject: short(`O teu código: ${vars.codigo ?? '------'}`, 50),
      preheader: short('Usa o código para confirmares o teu e-mail.', 90),
      title: 'Confirma o teu e-mail',
      greetingName: recipientName(vars),
      paragraphs: [
        'Usa este código para confirmares o teu e-mail:',
        `O código expira ao fim de ${vars.expiraEm ?? '10 minutos'} e só pode ser usado uma vez.`,
        'Também podes abrir a ligação abaixo com o código já preenchido.',
        'Se não pediste este código, ignora este e-mail.',
      ],
      code: vars.codigo ?? '------',
      cta: vars.url ? { label: 'Continuar no Conto Contigo', url: vars.url } : undefined,
      reason: 'pediste um código de confirmação no Conto Contigo',
    }),
    push: () =>
      pushMessage('Código de confirmação', 'Usa o código enviado para confirmares o teu e-mail.'),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: código ${vars.codigo ?? '------'}. Expira em ${vars.expiraEm ?? '10 minutos'}.`,
        vars.url
      ),
  },

  recuperar_senha: {
    code: 'recuperar_senha',
    email: (vars) => ({
      subject: short('Repõe a tua palavra-passe', 50),
      preheader: short('Abre a ligação para definires uma nova palavra-passe.', 90),
      title: 'Repõe a tua palavra-passe',
      greetingName: recipientName(vars),
      paragraphs: [
        'Recebemos um pedido para repor a palavra-passe da tua conta.',
        'A ligação expira ao fim de 60 minutos e só pode ser usada uma vez.',
        'Se não fizeste este pedido, ignora este e-mail.',
      ],
      cta: vars.url ? { label: 'Definir nova palavra-passe', url: vars.url } : undefined,
      reason: 'pediste para repor a palavra-passe',
    }),
    push: () =>
      pushMessage('Repor palavra-passe', 'Abre a ligação para definires uma nova palavra-passe.'),
    sms: (vars) => smsMessage('Conto Contigo: repõe a tua palavra-passe aqui:', vars.url),
  },

  convite_recebido: {
    code: 'convite_recebido',
    email: (vars) => {
      const paragraphs = [
        `${hostName(vars)} convidou-te para ${eventName(vars)}.`,
        'Confirma a tua presença para que possamos contar contigo.',
      ];

      if (vars.vestuario) {
        paragraphs.push(`Código de vestuário: ${vars.vestuario}.`);
      }

      if (vars.contribuicao) {
        paragraphs.push('Os dados de contribuição estão disponíveis na página do convite.');
      }

      return {
        subject: short(`${hostName(vars)} convidou-te para ${eventName(vars)}`, 50),
        preheader: short(
          `${hostName(vars)} convidou-te para ${eventName(vars)}. Confirma a tua presença.`,
          90
        ),
        title: 'Tens um convite',
        greetingName: recipientName(vars),
        paragraphs,
        details: eventDetails(vars),
        cta: vars.url ? { label: 'Ver convite', url: vars.url } : undefined,
        reason: `${hostName(vars)} convidou-te para este evento`,
      };
    },
    push: (vars) =>
      pushMessage(
        `${hostName(vars)} convidou-te`,
        `Convite para ${eventName(vars)}. Confirma a tua presença.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: ${hostName(vars)} convidou-te para ${eventName(vars)}. Responde aqui:`,
        vars.url
      ),
  },

  presenca_confirmada: {
    code: 'presenca_confirmada',
    email: (vars) => ({
      subject: short(`${guestName(vars)} vai ao teu evento`, 50),
      preheader: short(`${guestName(vars)} confirmou presença em ${eventName(vars)}.`, 90),
      title: 'Tens uma confirmação',
      greetingName: recipientName(vars),
      paragraphs: [
        `${guestName(vars)} confirmou presença em ${eventName(vars)}.`,
        'Já podes ver a lista de convidados e acompanhar as respostas.',
      ],
      cta: vars.url ? { label: 'Ver lista de convidados', url: vars.url } : undefined,
      reason: 'és anfitrião deste evento',
    }),
    push: (vars) =>
      pushMessage(
        `${guestName(vars)} vai ao teu evento`,
        `${eventName(vars)} tem uma nova confirmação.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: ${guestName(vars)} confirmou presença em ${eventName(vars)}.`,
        vars.url
      ),
  },

  lembrete_24h: {
    code: 'lembrete_24h',
    email: (vars) => ({
      subject: short(`Amanhã: ${eventName(vars)}`, 50),
      preheader: short(`${eventName(vars)} é amanhã. Vê os detalhes e confirma a tua presença.`, 90),
      title: 'O evento é amanhã',
      greetingName: recipientName(vars),
      paragraphs: reminderParagraphs(vars),
      details: eventDetails(vars),
      cta: reminderCta(vars, 'Ver detalhes'),
      reason: 'estás convidado para este evento',
    }),
    push: (vars) =>
      pushMessage(`Amanhã: ${eventName(vars)}`, 'Vê os detalhes e confirma a tua presença.'),
    sms: (vars) =>
      smsMessage(`Conto Contigo: ${eventName(vars)} é amanhã. Vê os detalhes:`, vars.url),
  },

  lembrete_2h: {
    code: 'lembrete_2h',
    email: (vars) => ({
      subject: short(`Daqui a 2 horas: ${eventName(vars)}`, 50),
      preheader: short(`${eventName(vars)} começa daqui a 2 horas.`, 90),
      title: 'O evento começa daqui a 2 horas',
      greetingName: recipientName(vars),
      paragraphs: reminderParagraphs(vars),
      details: eventDetails(vars),
      cta: reminderCta(vars, vars.online ? 'Entrar no evento' : 'Ver como chegar'),
      reason: 'estás convidado para este evento',
    }),
    push: (vars) =>
      pushMessage(`Daqui a 2 horas: ${eventName(vars)}`, 'O evento está quase a começar.'),
    sms: (vars) =>
      smsMessage(`Conto Contigo: ${eventName(vars)} começa daqui a 2 horas.`, vars.url),
  },

  evento_alterado: {
    code: 'evento_alterado',
    email: (vars) => ({
      subject: short(`Atualização: ${eventName(vars)} mudou`, 50),
      preheader: short(`A data, a hora ou o local de ${eventName(vars)} mudou.`, 90),
      title: 'O evento mudou',
      greetingName: recipientName(vars),
      paragraphs: [
        'O anfitrião atualizou os detalhes do evento.',
        'Confirma a nova data, hora e local antes de responderes.',
      ],
      details: eventDetails(vars),
      cta: vars.url ? { label: 'Ver alterações', url: vars.url } : undefined,
      reason: 'estás convidado para este evento',
    }),
    push: (vars) =>
      pushMessage(`Atualização: ${eventName(vars)}`, 'A data, a hora ou o local mudou.'),
    sms: (vars) =>
      smsMessage(`Conto Contigo: ${eventName(vars)} mudou. Vê as alterações:`, vars.url),
  },

  evento_cancelado: {
    code: 'evento_cancelado',
    email: (vars) => ({
      subject: short(`${eventName(vars)} foi cancelado`, 50),
      preheader: short(`${eventName(vars)} foi cancelado pelo anfitrião.`, 90),
      title: 'O evento foi cancelado',
      greetingName: recipientName(vars),
      paragraphs: [
        `O evento ${eventName(vars)} foi cancelado pelo anfitrião.`,
        'Não é necessário responder ao convite.',
      ],
      details: eventDetails(vars),
      reason: 'estavas convidado para este evento',
      tone: 'danger',
    }),
    push: (vars) =>
      pushMessage(`${eventName(vars)} foi cancelado`, 'O anfitrião cancelou o evento.'),
    sms: (vars) => smsMessage(`Conto Contigo: ${eventName(vars)} foi cancelado.`),
  },

  lembrete: {
    code: 'lembrete',
    email: (vars) => {
      const days = vars.dias;
      const title =
        typeof days === 'number' && days > 0 ? `Faltam ${days} dias` : 'Lembrete do evento';
      const lead =
        typeof days === 'number' && days > 0
          ? `Faltam ${days} dias para ${eventName(vars)}.`
          : `Lembrete de ${eventName(vars)}.`;

      return {
        subject: short(`${title}: ${eventName(vars)}`, 50),
        preheader: short(lead, 90),
        title,
        greetingName: recipientName(vars),
        paragraphs: [lead, ...reminderParagraphs(vars)],
        details: eventDetails(vars),
        cta: reminderCta(vars, 'Abrir convite'),
        reason: 'estás convidado para este evento',
      };
    },
    push: (vars) => pushMessage(`Lembrete: ${eventName(vars)}`, 'Vê os detalhes do evento.'),
    sms: (vars) => smsMessage(`Conto Contigo: lembrete de ${eventName(vars)}.`, vars.url),
  },

  manage_link: {
    code: 'manage_link',
    email: (vars) => ({
      subject: short(`A tua ligação de gestão — ${eventName(vars)}`, 50),
      preheader: short('Guarda a ligação secreta que te permite gerir o evento.', 90),
      title: 'Guarda a tua ligação de gestão',
      greetingName: recipientName(vars),
      paragraphs: [
        `O teu evento ${eventName(vars)} foi criado no Conto Contigo.`,
        'Guarda esta ligação: é a única forma de gerir o evento.',
        'Quem tiver a ligação pode gerir o evento e ver a lista de convidados. Não a partilhes com os convidados.',
      ],
      details: eventDetails(vars),
      cta: vars.url ? { label: 'Abrir gestão do evento', url: vars.url } : undefined,
      reason: 'criaste este evento no Conto Contigo',
    }),
    push: (vars) =>
      pushMessage('Ligação de gestão', `Guarda a ligação para gerires ${eventName(vars)}.`),
    sms: (vars) =>
      smsMessage(`Conto Contigo: ligação de gestão de ${eventName(vars)}:`, vars.url),
  },

  manager_invite: {
    code: 'manager_invite',
    email: (vars) => ({
      subject: short(`Foste adicionado como gestor — ${eventName(vars)}`, 50),
      preheader: short(`${hostName(vars)} adicionou-te como gestor do evento.`, 90),
      title: 'Foste adicionado como gestor',
      greetingName: recipientName(vars),
      paragraphs: [
        `${hostName(vars)} adicionou-te como gestor do evento ${eventName(vars)}.`,
        'Usa esta ligação para ver os convidados e ajudar a gerir o evento.',
        'Podes adicionar convidados e editar as informações do evento. Cancelar o evento, alterar o estado ou gerir convites existentes continua reservado ao anfitrião.',
        'Não partilhes esta ligação com os convidados.',
      ],
      details: eventDetails(vars),
      cta: vars.url ? { label: 'Abrir gestão do evento', url: vars.url } : undefined,
      reason: `${hostName(vars)} adicionou-te como gestor deste evento`,
    }),
    push: (vars) =>
      pushMessage('Foste adicionado como gestor', `Ajuda a gerir ${eventName(vars)}.`),
    sms: (vars) =>
      smsMessage(`Conto Contigo: és gestor de ${eventName(vars)}. Abre aqui:`, vars.url),
  },

  email_verification: {
    code: 'email_verification',
    email: (vars) => ({
      subject: short('Confirma o teu e-mail', 50),
      preheader: short('Confirma o teu e-mail para criares e gerires eventos.', 90),
      title: 'Confirma o teu e-mail',
      greetingName: recipientName(vars),
      paragraphs: [
        'Criaste uma conta no Conto Contigo. Confirma o teu e-mail para poderes criar e gerir eventos.',
        'A ligação expira ao fim de 24 horas e só pode ser usada uma vez.',
      ],
      cta: vars.url ? { label: 'Confirmar e-mail', url: vars.url } : undefined,
      reason: 'criaste uma conta no Conto Contigo',
    }),
    push: () =>
      pushMessage('Confirma o teu e-mail', 'Falta um passo para começares a criar eventos.'),
    sms: (vars) => smsMessage('Conto Contigo: confirma o teu e-mail aqui:', vars.url),
  },

  profile_reminder: {
    code: 'profile_reminder',
    email: (vars) => ({
      subject: short('Completa o teu perfil', 50),
      preheader: short('Falta preencher a tua data de nascimento.', 90),
      title: 'Completa o teu perfil',
      greetingName: recipientName(vars),
      paragraphs: [
        'Falta preencher a tua data de nascimento no perfil do Conto Contigo.',
        'Podes fazê-lo nas definições da conta.',
      ],
      cta: vars.url ? { label: 'Abrir definições', url: vars.url } : undefined,
      reason: 'a tua conta ainda não tem a data de nascimento',
    }),
    push: () =>
      pushMessage('Completa o teu perfil', 'Falta preencher a tua data de nascimento.'),
    sms: (vars) => smsMessage('Conto Contigo: completa o teu perfil aqui:', vars.url),
  },

  decline_notification: {
    code: 'decline_notification',
    email: (vars) => ({
      subject: short(`Convite recusado — ${eventName(vars)}`, 50),
      preheader: short(`${guestName(vars)} recusou o convite para ${eventName(vars)}.`, 90),
      title: 'Um convidado recusou',
      greetingName: recipientName(vars),
      paragraphs: [
        `${guestName(vars)} (${vars.detalhe ?? 'sem e-mail'}) recusou o convite para ${eventName(vars)}.`,
        'Os lembretes para este convidado foram cancelados.',
      ],
      reason: 'és o anfitrião deste evento',
    }),
    push: (vars) =>
      pushMessage(`${guestName(vars)} recusou o convite`, `${eventName(vars)} perdeu uma presença.`),
    sms: (vars) =>
      smsMessage(`Conto Contigo: ${guestName(vars)} recusou o convite para ${eventName(vars)}.`),
  },

  invitation_removed: {
    code: 'invitation_removed',
    email: (vars) => ({
      subject: short(`Convite removido — ${eventName(vars)}`, 50),
      preheader: short(`O teu convite para ${eventName(vars)} foi removido pelo anfitrião.`, 90),
      title: 'O teu convite foi removido',
      greetingName: recipientName(vars),
      paragraphs: [
        `O teu convite para ${eventName(vars)} foi removido pelo anfitrião.`,
        'A ligação que recebeste deixou de ser válida e já não é necessário responder.',
        'Se recebeste um convite novo para este evento, usa apenas a ligação mais recente.',
        'Se não reconheces este evento, podes ignorar esta mensagem.',
      ],
      reason: 'o teu convite para este evento foi removido',
      tone: 'danger',
    }),
    push: (vars) =>
      pushMessage(`Convite removido: ${eventName(vars)}`, 'A ligação que recebeste já não é válida.'),
    sms: (vars) => smsMessage(`Conto Contigo: o teu convite para ${eventName(vars)} foi removido.`),
  },

  equipa_convite: {
    code: 'equipa_convite',
    email: (vars) => ({
      subject: short(`Convite para a equipa ${vars.equipa ?? 'do evento'}`, 50),
      preheader: short(
        `${hostName(vars)} convidou-te para ajudares em ${eventName(vars)}.`,
        90
      ),
      title: 'Foste convidado para uma equipa',
      greetingName: recipientName(vars),
      paragraphs: [
        `${hostName(vars)} convidou-te para a equipa ${vars.equipa ?? 'do evento'} do evento ${eventName(vars)}.`,
        'Aceita o convite para veres as tarefas da equipa e acompanhares o que falta fazer.',
        `A ligação expira ao fim de ${vars.expiraEm ?? '7 dias'} e só pode ser usada uma vez.`,
      ],
      details: eventDetails(vars),
      cta: vars.url ? { label: 'Aceitar convite', url: vars.url } : undefined,
      reason: `${hostName(vars)} adicionou-te a esta equipa`,
    }),
    push: (vars) =>
      pushMessage(
        `Convite para a equipa ${vars.equipa ?? 'do evento'}`,
        `Ajuda a organizar ${eventName(vars)}.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: ${hostName(vars)} convidou-te para a equipa ${vars.equipa ?? 'do evento'}. Aceita aqui:`,
        vars.url
      ),
  },

  equipa_adicionado: {
    code: 'equipa_adicionado',
    email: (vars) => ({
      subject: short(`Foste adicionado à equipa ${vars.equipa ?? 'do evento'}`, 50),
      preheader: short(
        `${vars.autor ?? hostName(vars)} adicionou-te à equipa ${vars.equipa ?? 'do evento'} de ${eventName(vars)}.`,
        90
      ),
      title: 'Foste adicionado a uma equipa',
      greetingName: recipientName(vars),
      paragraphs: [
        `${vars.autor ?? hostName(vars)} adicionou-te à equipa ${vars.equipa ?? 'do evento'} do evento ${eventName(vars)}.`,
        'Já podes ver e assumir as tarefas desta equipa.',
        'Se não reconheces esta equipa, fala com o anfitrião do evento.',
      ],
      details: eventDetails(vars),
      cta: vars.url ? { label: 'Ver a equipa', url: vars.url } : undefined,
      reason: `${vars.autor ?? hostName(vars)} adicionou-te a esta equipa`,
    }),
    push: (vars) =>
      pushMessage(
        `Foste adicionado à equipa ${vars.equipa ?? 'do evento'}`,
        `Já podes ajudar a organizar ${eventName(vars)}.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: ${vars.autor ?? hostName(vars)} adicionou-te à equipa ${vars.equipa ?? 'do evento'}.`,
        vars.url
      ),
  },

  equipa_papel_alterado: {
    code: 'equipa_papel_alterado',
    email: (vars) => {
      const promoted = vars.papel === 'gestor';
      const actor = vars.autor ?? hostName(vars);
      const team = vars.equipa ?? 'do evento';

      return {
        subject: short(
          promoted ? `Passaste a gestor da equipa ${team}` : `O teu papel na equipa ${team} mudou`,
          50
        ),
        preheader: short(
          promoted
            ? `${actor} promoveu-te a gestor da equipa ${team} de ${eventName(vars)}.`
            : `${actor} alterou o teu papel na equipa ${team} de ${eventName(vars)}.`,
          90
        ),
        title: promoted ? 'Passaste a gestor' : 'O teu papel mudou',
        greetingName: recipientName(vars),
        paragraphs: promoted
          ? [
              `${actor} promoveu-te a gestor da equipa ${team} do evento ${eventName(vars)}.`,
              'Como gestor, podes ajudar a organizar a equipa e acompanhar as tarefas.',
              'As permissões de gestão do evento continuam a ser decididas pelo anfitrião.',
            ]
          : [
              `${actor} alterou o teu papel na equipa ${team} do evento ${eventName(vars)} para membro.`,
              'Continuas a ver e a concluir as tarefas que te forem atribuídas.',
            ],
        details: eventDetails(vars),
        cta: vars.url ? { label: 'Ver a equipa', url: vars.url } : undefined,
        reason: 'o teu papel nesta equipa mudou',
      };
    },
    push: (vars) => {
      const promoted = vars.papel === 'gestor';
      return pushMessage(
        promoted
          ? `Passaste a gestor da equipa ${vars.equipa ?? 'do evento'}`
          : `O teu papel na equipa ${vars.equipa ?? 'do evento'} mudou`,
        promoted ? 'Já podes ajudar a organizar a equipa.' : 'Continuas a ver as tuas tarefas.'
      );
    },
    sms: (vars) =>
      smsMessage(
        vars.papel === 'gestor'
          ? `Conto Contigo: passaste a gestor da equipa ${vars.equipa ?? 'do evento'}.`
          : `Conto Contigo: o teu papel na equipa ${vars.equipa ?? 'do evento'} mudou.`
      ),
  },

  tarefa_atribuida: {
    code: 'tarefa_atribuida',
    email: (vars) => {
      const paragraphs = [
        `${vars.autor ?? 'O anfitrião'} atribuiu-te a tarefa "${vars.tarefa ?? 'sem título'}" na equipa ${vars.equipa ?? 'do evento'} de ${eventName(vars)}.`,
      ];

      if (vars.prazo) {
        paragraphs.push(`Prazo: ${vars.prazo}.`);
      }

      paragraphs.push('Podes concluí-la quando estiver pronta.');

      return {
        subject: short(`Nova tarefa: ${vars.tarefa ?? 'sem título'}`, 50),
        preheader: short(`Ficaste responsável por uma tarefa em ${eventName(vars)}.`, 90),
        title: 'Tens uma nova tarefa',
        greetingName: recipientName(vars),
        paragraphs,
        details: eventDetails(vars),
        cta: vars.url ? { label: 'Ver tarefa', url: vars.url } : undefined,
        reason: 'és responsável por esta tarefa',
      };
    },
    push: (vars) =>
      pushMessage(
        `Nova tarefa: ${vars.tarefa ?? 'sem título'}`,
        `Ficaste responsável por uma tarefa em ${eventName(vars)}.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: nova tarefa "${vars.tarefa ?? 'sem título'}" em ${eventName(vars)}.`,
        vars.url
      ),
  },

  tarefa_concluida: {
    code: 'tarefa_concluida',
    email: (vars) => ({
      subject: short(`Tarefa concluída: ${vars.tarefa ?? 'sem título'}`, 50),
      preheader: short(
        `${vars.responsavel ?? 'O responsável'} concluiu uma tarefa em ${eventName(vars)}.`,
        90
      ),
      title: 'Tarefa concluída',
      greetingName: recipientName(vars),
      paragraphs: [
        `${vars.responsavel ?? 'O responsável'} concluiu a tarefa "${vars.tarefa ?? 'sem título'}" na equipa ${vars.equipa ?? 'do evento'}.`,
        'A tarefa já não aparece nas pendentes.',
      ],
      details: eventDetails(vars),
      cta: vars.url ? { label: 'Ver tarefa', url: vars.url } : undefined,
      reason: 'acompanhas as tarefas deste evento',
    }),
    push: (vars) =>
      pushMessage(
        `Tarefa concluída: ${vars.tarefa ?? 'sem título'}`,
        `${vars.responsavel ?? 'O responsável'} concluiu uma tarefa.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: "${vars.tarefa ?? 'sem título'}" foi concluída em ${eventName(vars)}.`,
        vars.url
      ),
  },

  tarefa_reatribuida: {
    code: 'tarefa_reatribuida',
    email: (vars) => {
      const paragraphs = [
        `${vars.autor ?? 'O anfitrião'} reatribuiu a tarefa "${vars.tarefa ?? 'sem título'}" da equipa ${vars.equipa ?? 'do evento'} a ${vars.responsavel ?? 'um novo responsável'}.`,
      ];

      if (vars.anterior) {
        paragraphs.push(`O responsável anterior era ${vars.anterior}.`);
      }

      paragraphs.push('O novo responsável passa a ser quem pode concluir a tarefa.');

      return {
        subject: short(`Tarefa reatribuída: ${vars.tarefa ?? 'sem título'}`, 50),
        preheader: short(
          `A tarefa "${vars.tarefa ?? 'sem título'}" passou para ${vars.responsavel ?? 'outra pessoa'}.`,
          90
        ),
        title: 'Tarefa reatribuída',
        greetingName: recipientName(vars),
        paragraphs,
        details: eventDetails(vars),
        cta: vars.url ? { label: 'Ver tarefa', url: vars.url } : undefined,
        reason: 'acompanhas as tarefas deste evento',
      };
    },
    push: (vars) =>
      pushMessage(
        `Tarefa reatribuída: ${vars.tarefa ?? 'sem título'}`,
        `A tarefa passou para ${vars.responsavel ?? 'outra pessoa'}.`
      ),
    sms: (vars) =>
      smsMessage(
        `Conto Contigo: "${vars.tarefa ?? 'sem título'}" passou para ${vars.responsavel ?? 'outra pessoa'}.`,
        vars.url
      ),
  },

};

/**
 * Aliases retrocompatíveis de códigos do catálogo.
 *
 * `convite_equipa` foi o nome usado na primeira entrega da Fase 3.
 * Continua a resolver para `equipa_convite` para que payloads antigos
 * da outbox e pré-visualizações guardadas não falhem. Novos usos devem
 * usar sempre o nome canónico.
 */
export const catalogAliases: Record<string, EmailTemplateCode> = {
  convite_equipa: 'equipa_convite',
};

/** Resolve um código do catálogo, aceitando aliases retrocompatíveis. */
export function resolveCatalogCode(code: string): EmailTemplateCode | null {
  if (code in catalog) return code as EmailTemplateCode;
  return catalogAliases[code] ?? null;
}

/** Lista estável usada pelo script de pré-visualização. */
export const catalogEntries: CatalogEntry[] = Object.values(catalog);

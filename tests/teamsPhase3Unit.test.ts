import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { redactPaths } from '../src/config/logger';
import { catalog, resolveCatalogCode } from '../src/emails/catalog';
import { renderEmailHtml, renderEmailText } from '../src/emails/render';
import type { DeliveryContext } from '../src/repositories/emailDelivery.repository';
import { renderDelivery } from '../src/services/email.service';
import { evaluateApplicability } from '../src/services/outbox.service';
import { maskEmail } from '../src/services/teamInvite.service';
import {
  formatDueDate,
  memberDisplayName,
  taskEventContext,
} from '../src/services/teamNotification.service';
import { Task } from '../src/types/team.types';
import { encryptToken } from '../src/utils/crypto.util';
import { links } from '../src/utils/links.util';

/**
 * Testes unitários da Fase 3: catálogo, renderização, aplicabilidade na
 * outbox e helpers das notificações.
 *
 * Não tocam na base de dados. Os testes de integração (convites,
 * notificações e anti-spam) vivem em `teamsPhase3.test.ts`.
 */

const EVENT_ID = 'f0000000-0000-4000-8000-000000000001';
const TASK_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const INVITE_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const TOKEN = 'token-de-convite-de-equipa-1234567890';
const EVENT_START = new Date('2030-01-31T18:00:00Z');
const TIMEZONE = 'Africa/Luanda';

function deliveryContext(overrides: Partial<DeliveryContext> = {}): DeliveryContext {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    eventId: EVENT_ID,
    invitationId: null,
    hostId: null,
    messageType: 'task_assigned',
    reminderKind: null,
    recipientEmail: 'ana@example.test',
    scheduledFor: new Date(),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    providerMessageId: null,
    lastError: null,
    idempotencyKey: 'team-phase3:test',
    tokenEncrypted: null,
    payload: {},
    sentAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    eventTitle: 'Casamento da Ana e do Paulo',
    eventStatus: 'scheduled',
    eventStartsAt: EVENT_START,
    eventEndsAt: null,
    eventTimezone: TIMEZONE,
    eventLocationType: 'venue',
    eventLocationName: 'Quinta das Flores',
    eventLocationAddress: 'Luanda',
    eventOnlineUrl: null,
    eventDressCode: null,
    eventRsvpDeadline: null,
    eventContributionEnabled: false,
    hostName: 'Pedro',
    hostEmail: 'pedro@example.test',
    guestName: null,
    guestEmail: null,
    invitationTokenEncrypted: null,
    rsvpStatus: null,
    claimRevokedAt: null,
    teamInviteAcceptedAt: null,
    teamInviteRevokedAt: null,
    teamInviteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    taskArchivedAt: null,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    hostId: 'cccccccc-0000-4000-8000-000000000001',
    eventId: EVENT_ID,
    eventTitle: 'Casamento da Ana e do Paulo',
    teamId: 'dddddddd-0000-4000-8000-000000000001',
    teamName: 'Cozinha',
    assigneeMemberId: 'eeeeeeee-0000-4000-8000-000000000001',
    assigneeEmail: 'ana@example.test',
    assigneeDisplayName: 'Ana',
    assigneeHasAccess: true,
    title: 'Comprar gelo',
    description: null,
    dueDate: '2030-01-31',
    priority: 'normal',
    status: 'por_fazer',
    createdByHostId: 'cccccccc-0000-4000-8000-000000000001',
    completedByMemberId: null,
    completedAt: null,
    archivedAt: null,
    label: 'Comprar gelo',
    done: false,
    managerId: null,
    managerEmail: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('catálogo e renderização da Fase 3', () => {
  it('tem as seis mensagens novas com texto em pt-PT', () => {
    const content = catalog.equipa_convite.email({
      nome: 'Ana',
      equipa: 'Cozinha',
      evento: 'Casamento',
      expiraEm: '7 dias',
      url: 'https://exemplo.test/equipas/convite/token',
    });

    expect(content.subject).toContain('Cozinha');
    expect(content.paragraphs.join(' ')).toContain('Aceita o convite');
    expect(content.cta).toEqual({
      label: 'Aceitar convite',
      url: 'https://exemplo.test/equipas/convite/token',
    });

    for (const code of [
      'equipa_convite',
      'equipa_adicionado',
      'equipa_papel_alterado',
      'tarefa_atribuida',
      'tarefa_concluida',
      'tarefa_reatribuida',
    ] as const) {
      const entry = catalog[code];
      const html = renderEmailHtml(
        entry.email({
          nome: 'Ana',
          equipa: 'Cozinha',
          evento: 'Casamento',
          tarefa: 'Gelo',
          autor: 'Pedro',
          papel: 'gestor',
        }),
        { baseUrl: 'https://exemplo.test', year: 2026 }
      );
      const text = renderEmailText(
        entry.email({
          nome: 'Ana',
          equipa: 'Cozinha',
          evento: 'Casamento',
          tarefa: 'Gelo',
          autor: 'Pedro',
          papel: 'gestor',
        }),
        { baseUrl: 'https://exemplo.test', year: 2026 }
      );

      expect(html).toContain('Conto Contigo');
      expect(text).toContain('Equipa Conto Contigo');
      expect(text).not.toContain('<');
    }
  });

  it('resolve o alias antigo convite_equipa para equipa_convite', () => {
    expect(resolveCatalogCode('convite_equipa')).toBe('equipa_convite');
    expect(resolveCatalogCode('equipa_convite')).toBe('equipa_convite');
    expect(resolveCatalogCode('mensagem_inexistente')).toBeNull();
  });

  it('já não expõe membro_removido no catálogo', () => {
    expect('membro_removido' in catalog).toBe(false);
    expect(Object.keys(catalog)).not.toContain('membro_removido');
  });

  it('renderiza o convite de equipa com o link de aceitação', () => {
    const message = renderDelivery(
      deliveryContext({
        messageType: 'team_invite',
        recipientEmail: 'ana@example.test',
        tokenEncrypted: encryptToken(TOKEN),
        payload: {
          inviteId: INVITE_ID,
          teamName: 'Cozinha',
          eventTitle: 'Casamento da Ana e do Paulo',
          recipientName: 'Ana',
          actorName: 'Pedro',
          expiryLabel: '7 dias',
        },
      })
    );

    expect(message.to).toBe('ana@example.test');
    expect(message.subject).toContain('Cozinha');
    expect(message.html).toContain(links.teamInvite(TOKEN));
    expect(message.text).toContain(links.teamInvite(TOKEN));
    expect(message.text.split(TOKEN)).toHaveLength(2);
  });

  it('renderiza a atribuição com tarefa, autor e prazo', () => {
    const message = renderDelivery(
      deliveryContext({
        messageType: 'task_assigned',
        payload: {
          taskId: TASK_ID,
          taskTitle: 'Comprar gelo',
          teamName: 'Cozinha',
          recipientName: 'Ana',
          actorName: 'Pedro',
          dueDate: '31 de jan. de 2030',
        },
      })
    );

    expect(message.subject).toContain('Comprar gelo');
    expect(message.text).toContain('Pedro atribuiu-te');
    expect(message.text).toContain('31 de jan. de 2030');
    expect(message.html).toContain(links.task(EVENT_ID, TASK_ID));
  });

  it('renderiza a conclusão e a reatribuição sem expor tokens', () => {
    const completed = renderDelivery(
      deliveryContext({
        messageType: 'task_completed',
        payload: {
          taskId: TASK_ID,
          taskTitle: 'Comprar gelo',
          teamName: 'Cozinha',
          recipientName: 'Pedro',
          assigneeName: 'Ana',
        },
      })
    );

    expect(completed.subject).toContain('Tarefa concluída');
    expect(completed.text).toContain('Ana concluiu');

    const reassigned = renderDelivery(
      deliveryContext({
        messageType: 'task_reassigned',
        payload: {
          taskId: TASK_ID,
          taskTitle: 'Comprar gelo',
          teamName: 'Cozinha',
          recipientName: 'Rita',
          assigneeName: 'Rita',
          previousAssigneeName: 'Ana',
          actorName: 'Pedro',
        },
      })
    );

    expect(reassigned.subject).toContain('Tarefa reatribuída');
    expect(reassigned.text).toContain('O responsável anterior era Ana');
  });

  it('renderiza a adição e a alteração de papel com CTA para a equipa', () => {
    const added = renderDelivery(
      deliveryContext({
        messageType: 'team_added',
        payload: {
          teamId: 'dddddddd-0000-4000-8000-000000000001',
          teamName: 'Cozinha',
          recipientName: 'Ana',
          actorName: 'Pedro',
        },
      })
    );

    expect(added.subject).toContain('Foste adicionado');
    expect(added.text).toContain('Pedro adicionou-te');
    expect(added.html).toContain(
      links.team(EVENT_ID, 'dddddddd-0000-4000-8000-000000000001')
    );

    const promoted = renderDelivery(
      deliveryContext({
        messageType: 'team_role_changed',
        payload: {
          teamId: 'dddddddd-0000-4000-8000-000000000001',
          teamName: 'Cozinha',
          recipientName: 'Ana',
          actorName: 'Pedro',
          role: 'gestor',
        },
      })
    );

    expect(promoted.subject).toContain('Passaste a gestor');
    expect(promoted.text).toContain('Pedro promoveu-te a gestor');

    const demoted = renderDelivery(
      deliveryContext({
        messageType: 'team_role_changed',
        payload: {
          teamId: 'dddddddd-0000-4000-8000-000000000001',
          teamName: 'Cozinha',
          recipientName: 'Ana',
          actorName: 'Pedro',
          role: 'membro',
        },
      })
    );

    expect(demoted.subject).toContain('O teu papel');
    expect(demoted.text).toContain('para membro');
  });

  it('escapa HTML no título da tarefa e no nome da equipa', () => {
    const message = renderDelivery(
      deliveryContext({
        messageType: 'task_assigned',
        payload: {
          taskId: TASK_ID,
          taskTitle: '<script>alert("x")</script>',
          teamName: '<b>Cozinha</b>',
          recipientName: 'Ana',
          actorName: 'Pedro',
        },
      })
    );

    expect(message.html).not.toContain('<script>alert');
    expect(message.html).not.toContain('<b>Cozinha</b>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).toContain('&lt;b&gt;Cozinha&lt;/b&gt;');
    expect(message.text).toContain('<script>alert("x")</script>');
  });

  it('produz uma versão text/plain sem marcação HTML', () => {
    const messages = [
      renderDelivery(
        deliveryContext({
          messageType: 'team_added',
          payload: {
            teamId: 'dddddddd-0000-4000-8000-000000000001',
            teamName: 'Cozinha',
            recipientName: 'Ana',
            actorName: 'Pedro',
          },
        })
      ),
      renderDelivery(
        deliveryContext({
          messageType: 'task_assigned',
          payload: {
            taskId: TASK_ID,
            taskTitle: 'Comprar gelo',
            teamName: 'Cozinha',
            recipientName: 'Ana',
            actorName: 'Pedro',
          },
        })
      ),
    ];

    for (const message of messages) {
      expect(message.text.length).toBeGreaterThan(0);
      expect(message.text).not.toContain('<html');
      expect(message.text).not.toContain('<p>');
      expect(message.text).not.toContain('<a ');
      expect(message.text).toContain('Equipa Conto Contigo');
    }
  });
});

describe('snapshots do texto dos emails da Fase 3', () => {
  const vars = {
    nome: 'Ana',
    equipa: 'Cozinha',
    evento: 'Casamento da Ana e do Paulo',
    expiraEm: '7 dias',
    autor: 'Pedro',
    papel: 'gestor',
    tarefa: 'Comprar gelo',
    prazo: '31 de jan. de 2030',
    url: 'https://exemplo.test/equipas/convite/token',
  };

  for (const code of [
    'equipa_convite',
    'equipa_adicionado',
    'equipa_papel_alterado',
    'tarefa_atribuida',
    'tarefa_concluida',
    'tarefa_reatribuida',
  ] as const) {
    it(`mantém o assunto e o text/plain de ${code}`, () => {
      const content = catalog[code].email(vars);
      const text = renderEmailText(content, { baseUrl: 'https://exemplo.test', year: 2026 });

      expect({ subject: content.subject, text }).toMatchSnapshot();
    });
  }
});

describe('evaluateApplicability das mensagens de equipa', () => {
  it('aceita um convite de equipa activo num evento agendado', () => {
    expect(evaluateApplicability(deliveryContext({ messageType: 'team_invite' }))).toEqual({
      ok: true,
    });
  });

  it('suprime o convite de equipa em rascunho, cancelado ou concluído', () => {
    expect(
      evaluateApplicability(deliveryContext({ messageType: 'team_invite', eventStatus: 'draft' }))
    ).toEqual({ ok: false, reason: 'event_draft' });

    expect(
      evaluateApplicability(
        deliveryContext({ messageType: 'team_invite', eventStatus: 'cancelled' })
      )
    ).toEqual({ ok: false, reason: 'event_cancelled' });

    expect(
      evaluateApplicability(
        deliveryContext({ messageType: 'team_invite', eventStatus: 'completed' })
      )
    ).toEqual({ ok: false, reason: 'event_completed' });
  });

  it('suprime o convite já aceite, revogado, expirado ou sem registo', () => {
    expect(
      evaluateApplicability(
        deliveryContext({ messageType: 'team_invite', teamInviteAcceptedAt: new Date() })
      )
    ).toEqual({ ok: false, reason: 'invite_accepted' });

    expect(
      evaluateApplicability(
        deliveryContext({ messageType: 'team_invite', teamInviteRevokedAt: new Date() })
      )
    ).toEqual({ ok: false, reason: 'invite_revoked' });

    expect(
      evaluateApplicability(
        deliveryContext({
          messageType: 'team_invite',
          teamInviteExpiresAt: new Date(Date.now() - 1000),
        })
      )
    ).toEqual({ ok: false, reason: 'invite_expired' });

    expect(
      evaluateApplicability(
        deliveryContext({ messageType: 'team_invite', teamInviteExpiresAt: null })
      )
    ).toEqual({ ok: false, reason: 'invite_missing' });
  });

  it('suprime mensagens de tarefas arquivadas ou de eventos terminados', () => {
    for (const messageType of [
      'task_assigned',
      'task_completed',
      'task_reassigned',
    ] as const) {
      expect(
        evaluateApplicability(deliveryContext({ messageType, taskArchivedAt: new Date() }))
      ).toEqual({ ok: false, reason: 'task_archived' });

      expect(
        evaluateApplicability(deliveryContext({ messageType, eventStatus: 'cancelled' }))
      ).toEqual({ ok: false, reason: 'event_cancelled' });

      expect(
        evaluateApplicability(deliveryContext({ messageType, eventStatus: 'completed' }))
      ).toEqual({ ok: false, reason: 'event_completed' });

      expect(evaluateApplicability(deliveryContext({ messageType }))).toEqual({ ok: true });
    }
  });

  it('entrega team_added e team_role_changed e suprime eventos cancelados', () => {
    for (const messageType of ['team_added', 'team_role_changed'] as const) {
      expect(evaluateApplicability(deliveryContext({ messageType }))).toEqual({ ok: true });

      expect(
        evaluateApplicability(deliveryContext({ messageType, eventStatus: 'cancelled' }))
      ).toEqual({ ok: false, reason: 'event_cancelled' });

      expect(
        evaluateApplicability(deliveryContext({ messageType, eventStatus: 'completed' }))
      ).toEqual({ ok: false, reason: 'event_completed' });
    }
  });
});

describe('helpers das notificações de equipa', () => {
  it('mascara a parte local do email no preview público', () => {
    expect(maskEmail('ana.silva@exemplo.pt')).toBe('a********@exemplo.pt');
    expect(maskEmail('ana.silva@exemplo.pt')).not.toContain('ana.silva');
    expect(maskEmail('sem-arroba')).toBe('***');
  });

  it('formata o prazo em pt-PT a partir de uma data de calendário', () => {
    const label = formatDueDate('2030-01-31');

    expect(label).toContain('31');
    expect(label).toContain('2030');
    expect(formatDueDate(null)).toBeUndefined();
  });

  it('usa o nome, o email ou um fallback seguro', () => {
    expect(memberDisplayName({ displayName: 'Ana', email: 'ana@example.test' })).toBe('Ana');
    expect(memberDisplayName({ displayName: '  ', email: 'ana@example.test' })).toBe(
      'ana@example.test'
    );
    expect(memberDisplayName({})).toBe('um membro da equipa');
  });

  it('constrói o contexto da tarefa apenas quando há evento', () => {
    const context = taskEventContext(task(), 'Pedro', 'pedro@example.test');

    expect(context).toMatchObject({
      taskId: TASK_ID,
      taskTitle: 'Comprar gelo',
      eventId: EVENT_ID,
      teamName: 'Cozinha',
      actorName: 'Pedro',
    });
    expect(context?.dueDate).toContain('2030');

    expect(taskEventContext(task({ eventId: null, teamId: null }), 'Pedro', null)).toBeNull();
  });

  it('constrói links estáveis para convites, equipas e tarefas', () => {
    expect(links.teamInvite(TOKEN)).toContain(`/equipas/convite/${TOKEN}`);
    expect(links.team(EVENT_ID, TASK_ID)).toContain(`/eventos/${EVENT_ID}/equipas?equipa=${TASK_ID}`);
    expect(links.task(EVENT_ID, TASK_ID)).toContain(`/eventos/${EVENT_ID}/tarefas?tarefa=${TASK_ID}`);
  });
});

describe('segurança dos registos e do transporte', () => {
  it('mascara emails e tokens nos registos', () => {
    let output = '';
    const stream = {
      write(chunk: string) {
        output += chunk;
      },
    };
    const log = pino({ redact: { paths: redactPaths, censor: '[redacted]' } }, stream);

    log.info(
      {
        token: 'segredo-token',
        recipientEmail: 'ana@example.test',
        payload: { token: 'outro-segredo', tokenEncrypted: 'texto-cifrado' },
      },
      'teste de redaction'
    );

    expect(output).not.toContain('segredo-token');
    expect(output).not.toContain('ana@example.test');
    expect(output).not.toContain('outro-segredo');
    expect(output).not.toContain('texto-cifrado');
    expect(output).toContain('[redacted]');
  });

  it('força o transporte json fora de produção', async () => {
    const original = process.env.EMAIL_TRANSPORT;
    process.env.EMAIL_TRANSPORT = 'brevo';
    vi.resetModules();

    try {
      const { resolveTransport } = await import('../src/services/email.service');
      expect(resolveTransport()).toBe('json');
    } finally {
      process.env.EMAIL_TRANSPORT = original;
      vi.resetModules();
    }
  });
});

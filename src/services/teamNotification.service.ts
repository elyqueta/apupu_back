import { PoolClient } from 'pg';
import { pool } from '../database/pool';
import { emailDeliveryRepository } from '../repositories/emailDelivery.repository';
import { hostRepository } from '../repositories/host.repository';
import { notificationRepository } from '../repositories/notification.repository';
import { MessageType } from '../types/emailDelivery.types';
import { Task, TeamMemberWithStats, TeamWithStats } from '../types/team.types';
import { encryptToken } from '../utils/crypto.util';

/**
 * Notificações transaccionais de equipas e tarefas (Fase 3).
 *
 * Cada função:
 * - enfileira o email na outbox com uma chave idempotente estável;
 * - cria a notificação in-app para a conta, quando existe;
 * - nunca envia diretamente: o worker da outbox é o único ponto de
 *   envio, para preservar retries, backoff e cancelamento.
 *
 * As funções aceitam um `PoolClient` para participarem na transacção da
 * operação de domínio. Sem cliente, abrem as suas próprias leituras.
 */

export interface TaskEventContext {
  taskId: string;
  taskTitle: string;
  eventId: string;
  eventTitle: string;
  teamName: string;
  dueDate?: string;
  actorName: string;
  actorEmail: string | null;
  /** Conta que criou a tarefa, quando difere do anfitrião do evento. */
  createdByHostId: string | null;
}

interface EventNotificationInfo {
  hostId: string;
  title: string;
  hostName: string | null;
  hostEmail: string | null;
}

/** Formata `YYYY-MM-DD` sem depender do fuso do servidor. */
export function formatDueDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Nome humano de um membro, com o email como fallback. */
export function memberDisplayName(member: {
  displayName?: string | null;
  email?: string | null;
}): string {
  return member.displayName?.trim() || member.email?.trim() || 'um membro da equipa';
}

/** Contexto de tarefa usado pelas mensagens. */
export function taskEventContext(
  task: Task,
  actorName: string,
  actorEmail: string | null
): TaskEventContext | null {
  if (!task.eventId) return null;

  return {
    taskId: task.id,
    taskTitle: task.title,
    eventId: task.eventId,
    eventTitle: task.eventTitle ?? 'o evento',
    teamName: task.teamName ?? 'Geral',
    dueDate: formatDueDate(task.dueDate),
    actorName,
    actorEmail,
    createdByHostId: task.createdByHostId,
  };
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function readEventInfo(
  eventId: string,
  client?: PoolClient
): Promise<EventNotificationInfo | null> {
  const runner = client ?? pool;
  const result = await runner.query<{
    host_id: string;
    title: string;
    host_name: string | null;
    host_email: string | null;
  }>(
    `SELECT host_id, title, host_name, host_email
       FROM events
      WHERE id = $1`,
    [eventId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    hostId: row.host_id,
    title: row.title,
    hostName: row.host_name,
    hostEmail: row.host_email,
  };
}

async function enqueue(
  data: {
    messageType: MessageType;
    recipientEmail: string;
    eventId: string;
    hostId: string | null;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    tokenEncrypted?: string | null;
  },
  client?: PoolClient
): Promise<void> {
  await emailDeliveryRepository.enqueue(
    {
      eventId: data.eventId,
      invitationId: null,
      hostId: data.hostId,
      messageType: data.messageType,
      reminderKind: null,
      recipientEmail: data.recipientEmail,
      scheduledFor: new Date(),
      idempotencyKey: data.idempotencyKey,
      tokenEncrypted: data.tokenEncrypted ?? null,
      payload: data.payload,
    },
    client
  );
}

async function notifyHost(
  data: {
    hostId: string;
    eventId: string;
    kind: Parameters<typeof notificationRepository.createForHost>[0]['kind'];
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
    dedupeKey: string;
  },
  client?: PoolClient
): Promise<void> {
  await notificationRepository.createForHost(
    {
      hostId: data.hostId,
      eventId: data.eventId,
      kind: data.kind,
      title: data.title,
      body: data.body,
      metadata: data.metadata,
      dedupeKey: data.dedupeKey,
    },
    client
  );
}

/**
 * Convite de equipa. O destinatário ainda não tem conta activa, por
 * isso só há email; o token vai cifrado na outbox.
 */
export async function notifyTeamInvite(
  data: {
    inviteId: string;
    sendCount: number;
    recipientEmail: string;
    recipientName: string | null;
    team: TeamWithStats;
    actorName: string;
    tokenPlain: string;
    expiryLabel: string;
  },
  client?: PoolClient
): Promise<void> {
  const event = await readEventInfo(data.team.eventId, client);

  await enqueue(
    {
      messageType: 'team_invite',
      recipientEmail: data.recipientEmail,
      eventId: data.team.eventId,
      hostId: event?.hostId ?? null,
      tokenEncrypted: encryptToken(data.tokenPlain),
      idempotencyKey: `team_invite:${data.inviteId}:${data.sendCount}`,
      payload: {
        inviteId: data.inviteId,
        teamId: data.team.id,
        teamName: data.team.name,
        eventTitle: data.team.eventTitle,
        recipientName: data.recipientName ?? undefined,
        actorName: data.actorName,
        expiryLabel: data.expiryLabel,
      },
    },
    client
  );
}

/** Atribuição de tarefa ao novo responsável. */
export async function notifyTaskAssigned(
  data: {
    event: TaskEventContext;
    assignee: TeamMemberWithStats;
    client?: PoolClient;
  }
): Promise<void> {
  const { event, assignee } = data;
  const isSelf = sameEmail(assignee.email, event.actorEmail);

  if (isSelf) return;

  if (assignee.hostId) {
    await notifyHost(
      {
        hostId: assignee.hostId,
        eventId: event.eventId,
        kind: 'task_assigned',
        title: `Nova tarefa: ${event.taskTitle}`,
        body: `${event.actorName} atribuiu-te uma tarefa na equipa ${event.teamName}.`,
        metadata: { task_id: event.taskId, team_name: event.teamName },
        dedupeKey: `task_assigned:${event.taskId}:${assignee.id}`,
      },
      data.client
    );
  }

  if (!assignee.email) return;

  await enqueue(
    {
      messageType: 'task_assigned',
      recipientEmail: assignee.email,
      eventId: event.eventId,
      hostId: assignee.hostId,
      idempotencyKey: `task_assigned:${event.taskId}:${assignee.id}`,
      payload: {
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        teamName: event.teamName,
        recipientName: memberDisplayName(assignee),
        actorName: event.actorName,
        dueDate: event.dueDate,
      },
    },
    data.client
  );
}

/**
 * Conclusão de tarefa.
 *
 * Avisa apenas quem criou a tarefa (se não for o responsável) e o
 * anfitrião do evento (se for diferente do criador e do responsável).
 * Os gestores deixam de ser notificados em bloco: não são donos da
 * tarefa e o aviso tornava-se ruído. Uma única notificação por pessoa,
 * mesmo que criador e anfitrião sejam a mesma conta.
 */
export async function notifyTaskCompleted(
  data: {
    event: TaskEventContext;
    assignee: TeamMemberWithStats;
    client?: PoolClient;
  }
): Promise<void> {
  const { event, assignee } = data;
  const info = await readEventInfo(event.eventId, data.client);

  if (!info) return;

  const assigneeName = memberDisplayName(assignee);
  const title = `Tarefa concluída: ${event.taskTitle}`;
  const body = `${assigneeName} concluiu uma tarefa na equipa ${event.teamName}.`;
  const metadata = { task_id: event.taskId, team_name: event.teamName };

  // Criador da tarefa. Pode coincidir com o anfitrião; nesse caso não
  // há uma segunda leitura.
  const creator =
    event.createdByHostId && event.createdByHostId !== info.hostId
      ? await hostRepository.findById(event.createdByHostId, data.client)
      : null;

  // Notificação in-app: uma por conta, nunca para o responsável.
  const notifiedHosts = new Set<string>();

  const notifyRecipient = async (
    hostId: string,
    email: string | null,
    name: string | null
  ): Promise<void> => {
    if (sameEmail(email, assignee.email)) return;

    if (!notifiedHosts.has(hostId)) {
      notifiedHosts.add(hostId);
      await notifyHost(
        {
          hostId,
          eventId: event.eventId,
          kind: 'task_completed',
          title,
          body,
          metadata,
          dedupeKey: `task_completed:${event.taskId}:${hostId}`,
        },
        data.client
      );
    }

    if (!email) return;

    await enqueue(
      {
        messageType: 'task_completed',
        recipientEmail: email,
        eventId: event.eventId,
        hostId,
        idempotencyKey: `task_completed:${event.taskId}:${email.toLowerCase()}`,
        payload: {
          taskId: event.taskId,
          taskTitle: event.taskTitle,
          teamName: event.teamName,
          recipientName: name ?? undefined,
          assigneeName,
        },
      },
      data.client
    );
  };

  await notifyRecipient(info.hostId, info.hostEmail, info.hostName);

  if (creator) {
    await notifyRecipient(
      creator.id,
      creator.email,
      creator.profile.displayName
    );
  }
}

/** Reatribuição: avisa o novo responsável e o anterior. */
export async function notifyTaskReassigned(
  data: {
    event: TaskEventContext;
    newAssignee: TeamMemberWithStats;
    previousAssignee: TeamMemberWithStats | null;
    client?: PoolClient;
  }
): Promise<void> {
  const { event, newAssignee, previousAssignee } = data;
  const recipients: TeamMemberWithStats[] = [newAssignee];

  if (previousAssignee && previousAssignee.id !== newAssignee.id) {
    recipients.push(previousAssignee);
  }

  for (const recipient of recipients) {
    if (sameEmail(recipient.email, event.actorEmail)) continue;

    const isNewAssignee = recipient.id === newAssignee.id;
    const variant = isNewAssignee ? 'novo' : 'anterior';

    if (recipient.hostId) {
      await notifyHost(
        {
          hostId: recipient.hostId,
          eventId: event.eventId,
          kind: 'task_reassigned',
          title: isNewAssignee
            ? `Passaram-te a tarefa: ${event.taskTitle}`
            : `Já não és responsável: ${event.taskTitle}`,
          body: isNewAssignee
            ? `${event.actorName} passou-te a tarefa na equipa ${event.teamName}.`
            : `A tarefa passou para ${memberDisplayName(newAssignee)} na equipa ${event.teamName}.`,
          metadata: {
            task_id: event.taskId,
            team_name: event.teamName,
            assignee_member_id: newAssignee.id,
          },
          dedupeKey: `task_reassigned:${event.taskId}:${newAssignee.id}:${recipient.id}`,
        },
        data.client
      );
    }

    if (!recipient.email) continue;

    await enqueue(
      {
        messageType: 'task_reassigned',
        recipientEmail: recipient.email,
        eventId: event.eventId,
        hostId: recipient.hostId,
        idempotencyKey: `task_reassigned:${event.taskId}:${newAssignee.id}:${recipient.id}`,
        payload: {
          taskId: event.taskId,
          taskTitle: event.taskTitle,
          teamName: event.teamName,
          recipientName: memberDisplayName(recipient),
          assigneeName: memberDisplayName(newAssignee),
          previousAssigneeName: previousAssignee
            ? memberDisplayName(previousAssignee)
            : undefined,
          actorName: event.actorName,
          variant,
        },
      },
      data.client
    );
  }
}

/**
 * Adição de um membro com conta verificada: notificação in-app e email.
 *
 * Quem é removido nunca recebe mensagem; a remoção é silenciosa. Este
 * aviso existe apenas para a entrada (ou reentrada) numa equipa.
 */
export async function notifyTeamMemberAdded(
  data: {
    eventId: string;
    teamId: string;
    teamName: string;
    member: TeamMemberWithStats;
    actorName: string;
    actorEmail: string | null;
    client?: PoolClient;
  }
): Promise<void> {
  const { member } = data;

  if (!member.hostId || !member.email) return;
  if (sameEmail(member.email, data.actorEmail)) return;

  const version = member.updatedAt.getTime();
  const dedupeKey = `team_added:${member.id}:${version}`;

  await notifyHost(
    {
      hostId: member.hostId,
      eventId: data.eventId,
      kind: 'team_added',
      title: `Foste adicionado à equipa ${data.teamName}`,
      body: `${data.actorName} adicionou-te à equipa ${data.teamName}.`,
      metadata: { team_id: data.teamId, team_name: data.teamName, member_id: member.id },
      dedupeKey,
    },
    data.client
  );

  await enqueue(
    {
      messageType: 'team_added',
      recipientEmail: member.email,
      eventId: data.eventId,
      hostId: member.hostId,
      idempotencyKey: dedupeKey,
      payload: {
        teamId: data.teamId,
        teamName: data.teamName,
        recipientName: memberDisplayName(member),
        actorName: data.actorName,
      },
    },
    data.client
  );
}

/**
 * Alteração de papel: notificação in-app e email.
 *
 * Promoção e despromoção têm o mesmo tratamento. A própria pessoa que
 * executou a acção não é notificada.
 */
export async function notifyRoleChanged(
  data: {
    eventId: string;
    teamId: string;
    member: TeamMemberWithStats;
    teamName: string;
    actorName: string;
    actorEmail: string | null;
    client?: PoolClient;
  }
): Promise<void> {
  const { member } = data;

  if (!member.hostId || !member.email) return;
  if (sameEmail(member.email, data.actorEmail)) return;

  const promoted = member.role === 'gestor';
  const version = member.updatedAt.getTime();
  const dedupeKey = `role_changed:${member.id}:${member.role}:${version}`;

  await notifyHost(
    {
      hostId: member.hostId,
      eventId: data.eventId,
      kind: 'role_changed',
      title: promoted ? 'Passaste a gestor do evento' : 'O teu papel mudou',
      body: promoted
        ? `${data.actorName} promoveu-te a gestor do evento (equipa ${data.teamName}).`
        : `${data.actorName} alterou o teu papel na equipa ${data.teamName}.`,
      metadata: { team_name: data.teamName, role: member.role, member_id: member.id },
      dedupeKey,
    },
    data.client
  );

  await enqueue(
    {
      messageType: 'team_role_changed',
      recipientEmail: member.email,
      eventId: data.eventId,
      hostId: member.hostId,
      idempotencyKey: dedupeKey,
      payload: {
        teamId: data.teamId,
        teamName: data.teamName,
        recipientName: memberDisplayName(member),
        actorName: data.actorName,
        role: member.role,
      },
    },
    data.client
  );
}

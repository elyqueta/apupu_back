import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Correções da Fase 3: resiliência da outbox, idempotência,
 * recuperação de linhas presas, limite por IP nas rotas públicas e a
 * garantia de que "Não conheço este convite" só revoga no `POST`.
 *
 * Corre contra uma CÓPIA já migrada, indicada por `TEAMS_API_TEST_URL`.
 * Usa UUIDs e emails próprios para não colidir com os outros ficheiros.
 */
const connectionString = process.env.TEAMS_API_TEST_URL;

if (process.env.CI && !connectionString) {
  throw new Error(
    'TEAMS_API_TEST_URL é obrigatório em CI. Use `npm run test:teams` para preparar a base de dados.'
  );
}

if (connectionString) {
  process.env.DATABASE_URL = connectionString;
}

// Têm de ser definidos antes de importar `config/env.ts` (feito de
// forma dinâmica em `beforeAll`). O proxy é necessário para que
// `X-Forwarded-For` seja respeitado nos testes de rate limit.
process.env.TRUST_PROXY = '1';
process.env.RATE_LIMIT_MAX = '1000';
process.env.PUBLIC_RATE_LIMIT_WINDOW_MS = '60000';
process.env.PUBLIC_RATE_LIMIT_MAX = '1000';
process.env.TEAM_INVITE_RATE_LIMIT_WINDOW_MS = '60000';
process.env.TEAM_INVITE_RATE_LIMIT_MAX = '20';
process.env.EMAIL_MAX_ATTEMPTS = '5';
process.env.EMAIL_RETRY_BASE_MS = '60000';

/**
 * O worker importa `sendMail` diretamente. Mantemos o resto do módulo
 * real (catálogo e `renderDelivery`) e substituímos apenas o transporte
 * para simular falhas sem tocar na rede.
 */
vi.mock('../src/services/email.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/email.service')>();
  return { ...actual, sendMail: vi.fn() };
});

const HOST_OWNER = 'c1111111-1111-4111-8111-111111111111';
const HOST_MEMBER = 'c2222222-2222-4222-8222-222222222222';
const EVENT = 'd1111111-1111-4111-8111-111111111111';
const MANAGER_ID = 'e1111111-1111-4111-8111-111111111111';

const EMAIL_OWNER = 'corr-owner@exemplo.pt';
const EMAIL_MANAGER = 'corr-manager@exemplo.pt';
const EMAIL_MEMBER = 'corr-member@exemplo.pt';
const EMAIL_PENDING = 'corr-pending@exemplo.pt';

const HOST_IDS = [HOST_OWNER, HOST_MEMBER];
const EVENT_IDS = [EVENT];

interface Scope {
  hostId: string;
  managerEmail: string | null;
}

const scopeOwner: Scope = { hostId: HOST_OWNER, managerEmail: EMAIL_OWNER };

type TeamService = typeof import('../src/services/team.service').teamService;
type TeamMemberService = typeof import('../src/services/teamMember.service').teamMemberService;
type TaskService = typeof import('../src/services/task.service').taskService;
type EmailDeliveryRepository =
  typeof import('../src/repositories/emailDelivery.repository').emailDeliveryRepository;
type ProcessOutbox = typeof import('../src/services/outbox.service').processOutbox;
type NotifyTaskAssigned =
  typeof import('../src/services/teamNotification.service').notifyTaskAssigned;
type NotifyRoleChanged =
  typeof import('../src/services/teamNotification.service').notifyRoleChanged;
type DecryptToken = typeof import('../src/utils/crypto.util').decryptToken;
type TeamMember = import('../src/types/team.types').TeamMemberWithStats;
type TaskEventContext =
  import('../src/services/teamNotification.service').TaskEventContext;

describe.skipIf(!connectionString)(
  'correções da Fase 3: outbox, idempotência e rotas públicas',
  () => {
    let pool: import('pg').Pool;
    let app: import('express').Application;
    let teamService: TeamService;
    let teamMemberService: TeamMemberService;
    let taskService: TaskService;
    let emailDeliveryRepository: EmailDeliveryRepository;
    let processOutbox: ProcessOutbox;
    let notifyTaskAssigned: NotifyTaskAssigned;
    let notifyRoleChanged: NotifyRoleChanged;
    let decryptToken: DecryptToken;
    let sendMailMock: ReturnType<typeof vi.fn>;

    let teamId: string;
    let memberId: string;
    let pendingMemberId: string;
    let pendingInviteId: string;
    let pendingInviteToken: string;

    async function memberIdFor(email: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM team_members
          WHERE team_id = $1 AND email = $2::citext AND removed_at IS NULL`,
        [teamId, email]
      );

      expect(rows).toHaveLength(1);
      return rows[0]!.id;
    }

    async function deliveryIdForTask(taskId: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM email_deliveries
          WHERE message_type = 'task_assigned' AND payload->>'taskId' = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [taskId]
      );

      expect(rows).toHaveLength(1);
      return rows[0]!.id;
    }

    /**
     * Deixa apenas a entrega indicada vencida. Todas as outras ficam
     * agendadas para o dia seguinte, para que o worker não processe
     * resíduos de outros testes.
     */
    async function prepareOnly(deliveryId: string): Promise<void> {
      await pool.query(
        `UPDATE email_deliveries
            SET next_attempt_at = now() + interval '1 day'
          WHERE status = 'pending' AND id <> $1`,
        [deliveryId]
      );
      await pool.query(
        `UPDATE email_deliveries
            SET status = 'pending', attempts = 0, next_attempt_at = NULL,
                scheduled_for = now(), last_error = NULL
          WHERE id = $1`,
        [deliveryId]
      );
    }

    async function postponePending(): Promise<void> {
      await pool.query(
        `UPDATE email_deliveries
            SET next_attempt_at = now() + interval '1 day'
          WHERE status = 'pending'`
      );
    }

    beforeAll(async () => {
      ({ pool } = await import('../src/database/pool'));
      ({ teamService } = await import('../src/services/team.service'));
      ({ teamMemberService } = await import('../src/services/teamMember.service'));
      ({ taskService } = await import('../src/services/task.service'));
      ({ emailDeliveryRepository } = await import(
        '../src/repositories/emailDelivery.repository'
      ));
      ({ processOutbox } = await import('../src/services/outbox.service'));
      ({ notifyTaskAssigned, notifyRoleChanged } = await import(
        '../src/services/teamNotification.service'
      ));
      ({ decryptToken } = await import('../src/utils/crypto.util'));
      app = (await import('../src/app')).default;

      const emailService = await import('../src/services/email.service');
      sendMailMock = vi.mocked(emailService.sendMail) as unknown as ReturnType<typeof vi.fn>;

      await pool.query(
        `DELETE FROM team_invite_blocks WHERE host_id = ANY($1::uuid[]) OR email = ANY($2::citext[])`,
        [HOST_IDS, [EMAIL_OWNER, EMAIL_MANAGER, EMAIL_MEMBER, EMAIL_PENDING]]
      );
      await pool.query('DELETE FROM email_deliveries WHERE event_id = ANY($1::uuid[])', [
        EVENT_IDS,
      ]);
      await pool.query('DELETE FROM host_notifications WHERE event_id = ANY($1::uuid[])', [
        EVENT_IDS,
      ]);
      await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
      await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
      await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [
        EVENT_IDS,
      ]);
      await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
      await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [
        HOST_IDS,
      ]);
      await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);

      await pool.query(
        `INSERT INTO hosts (id, email, password_hash, email_verified_at, status) VALUES
           ($1, $2, 'x', now(), 'active'),
           ($3, $4, 'x', now(), 'active')`,
        [HOST_OWNER, EMAIL_OWNER, HOST_MEMBER, EMAIL_MEMBER]
      );

      await pool.query(
        `INSERT INTO host_profiles (host_id, display_name) VALUES
           ($1, 'Anfitriã Correções'), ($2, 'Membro Correções')`,
        [HOST_OWNER, HOST_MEMBER]
      );

      await pool.query(
        `INSERT INTO events (
           id, manage_token_hash, title, host_name, host_email, starts_at, status,
           host_id, location_type, location_name
         ) VALUES ($1, 'corrections-hash', 'Evento Correções', 'Anfitriã Correções', $2,
                   now() + interval '30 days', 'scheduled', $3, 'venue', 'Quinta Correções')`,
        [EVENT, EMAIL_OWNER, HOST_OWNER]
      );

      await pool.query(
        `WITH new_team AS (
           INSERT INTO teams (event_id, name, category, description, deleted_at)
           VALUES ($2, 'Equipa do Gestor Correções', 'outra', 'Equipa criada para testes.', now())
           RETURNING id
         )
         INSERT INTO event_managers (id, event_id, team_id, email)
         SELECT $1, $2, id, $3 FROM new_team`,
        [MANAGER_ID, EVENT, EMAIL_MANAGER]
      );

      teamId = (
        await teamService.create(scopeOwner, {
          event_id: EVENT,
          name: 'Correções',
          category: 'outra',
          description: null,
        })
      ).id;

      await teamMemberService.add(scopeOwner, teamId, { emails: [EMAIL_MEMBER] });
      memberId = await memberIdFor(EMAIL_MEMBER);

      const pending = await teamMemberService.add(scopeOwner, teamId, {
        emails: [EMAIL_PENDING],
      });
      pendingMemberId = pending.pending[0]!.memberId!;

      const invite = await pool.query<{ id: string; token_encrypted: string }>(
        `SELECT ti.id, d.token_encrypted
           FROM team_invites ti
           JOIN email_deliveries d
             ON d.message_type = 'team_invite'
            AND d.payload->>'inviteId' = ti.id::text
          WHERE ti.member_id = $1
          ORDER BY d.created_at DESC
          LIMIT 1`,
        [pendingMemberId]
      );

      expect(invite.rows).toHaveLength(1);
      pendingInviteId = invite.rows[0]!.id;
      pendingInviteToken = decryptToken(invite.rows[0]!.token_encrypted);
    });

    afterAll(async () => {
      if (!pool) return;

      await pool.query('DELETE FROM team_invite_blocks WHERE host_id = ANY($1::uuid[])', [
        HOST_IDS,
      ]);
      await pool.query('DELETE FROM email_deliveries WHERE event_id = ANY($1::uuid[])', [
        EVENT_IDS,
      ]);
      await pool.query('DELETE FROM host_notifications WHERE event_id = ANY($1::uuid[])', [
        EVENT_IDS,
      ]);
      await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
      await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
      await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [
        EVENT_IDS,
      ]);
      await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
      await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [
        HOST_IDS,
      ]);
      await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);
      await pool.end();
    });

    it('continua a ação e deixa a entrega pending quando o transporte falha', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Tarefa com falha de transporte',
        team_id: teamId,
        assignee_member_id: memberId,
        priority: 'normal',
        status: 'por_fazer',
      });

      const deliveryId = await deliveryIdForTask(task.id);
      await prepareOnly(deliveryId);

      sendMailMock.mockReset();
      sendMailMock.mockRejectedValue(new Error('transporte indisponível'));

      const result = await processOutbox();

      expect(result.retried).toBeGreaterThanOrEqual(1);

      const delivery = await emailDeliveryRepository.findById(deliveryId);
      expect(delivery).toMatchObject({
        status: 'pending',
        attempts: 1,
      });
      expect(delivery?.lastError).toContain('transporte indisponível');
      expect(delivery?.nextAttemptAt).not.toBeNull();

      // A tarefa foi criada antes do envio: a falha do transporte não
      // desfaz a ação de domínio.
      const { rows } = await pool.query<{ id: string }>(
        'SELECT id FROM host_tasks WHERE id = $1',
        [task.id]
      );
      expect(rows).toHaveLength(1);
    });

    it('marca a entrega como failed ao atingir EMAIL_MAX_ATTEMPTS', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Tarefa que esgota tentativas',
        team_id: teamId,
        assignee_member_id: memberId,
        priority: 'normal',
        status: 'por_fazer',
      });

      const deliveryId = await deliveryIdForTask(task.id);
      await prepareOnly(deliveryId);

      const max = Number(process.env.EMAIL_MAX_ATTEMPTS);
      await pool.query(
        `UPDATE email_deliveries
            SET attempts = $2, next_attempt_at = NULL, scheduled_for = now()
          WHERE id = $1`,
        [deliveryId, max - 1]
      );

      sendMailMock.mockReset();
      sendMailMock.mockRejectedValue(new Error('transporte continua em baixo'));

      const result = await processOutbox();

      expect(result.failed).toBeGreaterThanOrEqual(1);

      const delivery = await emailDeliveryRepository.findById(deliveryId);
      expect(delivery).toMatchObject({
        status: 'failed',
        attempts: max,
      });
      expect(delivery?.lastError).toContain('transporte continua em baixo');
      expect(delivery?.nextAttemptAt).toBeNull();
    });

    it('não duplica a mesma chave idempotente (tipo, entidade, versão)', async () => {
      const taskId = 'a1111111-1111-4111-8111-111111111111';
      const event: TaskEventContext = {
        taskId,
        taskTitle: 'Tarefa idempotente',
        eventId: EVENT,
        eventTitle: 'Evento Correções',
        teamName: 'Correções',
        actorName: 'Anfitriã Correções',
        actorEmail: EMAIL_OWNER,
        createdByHostId: HOST_OWNER,
      };
      const assignee = {
        id: memberId,
        email: EMAIL_MEMBER,
        hostId: HOST_MEMBER,
        displayName: 'Membro Correções',
      } as unknown as TeamMember;

      await notifyTaskAssigned({ event, assignee });
      await notifyTaskAssigned({ event, assignee });

      const taskKey = `task_assigned:${taskId}:${memberId}`;
      const taskDeliveries = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM email_deliveries WHERE idempotency_key = $1`,
        [taskKey]
      );
      expect(taskDeliveries.rows[0]!.count).toBe(1);

      const version = new Date('2026-01-01T00:00:00.000Z');
      const roleMember = {
        id: memberId,
        email: EMAIL_MEMBER,
        hostId: HOST_MEMBER,
        displayName: 'Membro Correções',
        role: 'gestor',
        updatedAt: version,
      } as unknown as TeamMember;

      const roleChange = {
        eventId: EVENT,
        teamId,
        member: roleMember,
        teamName: 'Correções',
        actorName: 'Anfitriã Correções',
        actorEmail: EMAIL_OWNER,
      };

      await notifyRoleChanged(roleChange);
      await notifyRoleChanged(roleChange);

      const firstVersionKey = `role_changed:${memberId}:gestor:${version.getTime()}`;
      const firstVersion = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM email_deliveries WHERE idempotency_key = $1`,
        [firstVersionKey]
      );
      expect(firstVersion.rows[0]!.count).toBe(1);

      // Uma nova versão do membro é uma nova notificação: a chave muda.
      await notifyRoleChanged({
        ...roleChange,
        member: {
          ...roleMember,
          updatedAt: new Date(version.getTime() + 1000),
        } as TeamMember,
      });

      const secondVersionKey = `role_changed:${memberId}:gestor:${
        version.getTime() + 1000
      }`;
      const secondVersion = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM email_deliveries WHERE idempotency_key = $1`,
        [secondVersionKey]
      );
      expect(secondVersion.rows[0]!.count).toBe(1);
    });

    it('recupera entregas presas em processing e volta a enviá-las', async () => {
      await postponePending();

      const delivery = await emailDeliveryRepository.enqueue({
        eventId: EVENT,
        invitationId: null,
        hostId: HOST_OWNER,
        messageType: 'task_assigned',
        reminderKind: null,
        recipientEmail: EMAIL_MEMBER,
        scheduledFor: new Date(),
        idempotencyKey: `corrections:recovery:${Date.now()}`,
        payload: {
          taskId: 'a2222222-2222-4222-8222-222222222222',
          taskTitle: 'Tarefa recuperada',
          teamName: 'Correções',
          actorName: 'Anfitriã Correções',
        },
      });

      expect(delivery).not.toBeNull();

      await pool.query(
        `UPDATE email_deliveries
            SET status = 'processing', attempts = 2,
                updated_at = now() - interval '11 minutes'
          WHERE id = $1`,
        [delivery!.id]
      );

      sendMailMock.mockReset();
      sendMailMock.mockResolvedValue({ providerMessageId: 'recuperada-1' });

      const result = await processOutbox();

      expect(result.recovered).toBeGreaterThanOrEqual(1);

      const recovered = await emailDeliveryRepository.findById(delivery!.id);
      expect(recovered).toMatchObject({
        status: 'sent',
        attempts: 3,
        providerMessageId: 'recuperada-1',
      });
    });

    it('limita a 20 pedidos por minuto e por IP em cada ação pública', async () => {
      const token = 'a'.repeat(40);

      async function exhaust(
        method: 'get' | 'post',
        path: string,
        ip: string
      ): Promise<void> {
        const agent = request(app);

        for (let index = 0; index < 20; index += 1) {
          const response =
            method === 'get'
              ? await agent.get(path).set('X-Forwarded-For', ip)
              : await agent.post(path).set('X-Forwarded-For', ip);

          expect(
            response.status,
            `${method.toUpperCase()} ${path} pedido ${index + 1}`
          ).not.toBe(429);
        }

        const blocked =
          method === 'get'
            ? await agent.get(path).set('X-Forwarded-For', ip)
            : await agent.post(path).set('X-Forwarded-For', ip);

        expect(blocked.status).toBe(429);
        expect(blocked.body).toMatchObject({
          error: { code: 'rate_limited' },
        });
      }

      await exhaust('get', `/api/v1/public/team-invites/${token}`, '198.51.100.10');
      await exhaust('post', `/api/v1/public/team-invites/${token}/accept`, '198.51.100.11');
      await exhaust('post', `/api/v1/public/team-invites/${token}/report`, '198.51.100.12');
      await exhaust('get', `/api/v1/public/team-invites/${token}/report`, '198.51.100.13');
    });

    it('isola o limite por IP real atrás do proxy', async () => {
      const token = 'd'.repeat(40);
      const path = `/api/v1/public/team-invites/${token}`;
      const ipA = '198.51.100.40';
      const ipB = '198.51.100.41';

      // O mesmo IP esgota o seu próprio contador...
      for (let index = 0; index < 20; index += 1) {
        const response = await request(app).get(path).set('X-Forwarded-For', ipA);
        expect(response.status).not.toBe(429);
      }

      const sameIp = await request(app).get(path).set('X-Forwarded-For', ipA);
      expect(sameIp.status).toBe(429);

      // ...e outro IP não herda esse contador.
      const otherIp = await request(app).get(path).set('X-Forwarded-For', ipB);
      expect(otherIp.status).not.toBe(429);
    });

    it('envia Referrer-Policy e Cache-Control nas respostas públicas de convites', async () => {
      const preview = await request(app)
        .get(`/api/v1/public/team-invites/${pendingInviteToken}`)
        .set('X-Forwarded-For', '198.51.100.50');

      expect(preview.status).toBe(200);
      expect(preview.headers['referrer-policy']).toBe('no-referrer');
      expect(preview.headers['cache-control']).toBe('no-store');

      const getReport = await request(app)
        .get(`/api/v1/public/team-invites/${pendingInviteToken}/report`)
        .set('X-Forwarded-For', '198.51.100.51');

      expect(getReport.status).toBe(405);
      expect(getReport.headers['referrer-policy']).toBe('no-referrer');
      expect(getReport.headers['cache-control']).toBe('no-store');

      const postReport = await request(app)
        .post(`/api/v1/public/team-invites/${'e'.repeat(40)}/report`)
        .set('X-Forwarded-For', '198.51.100.52');

      expect(postReport.status).toBe(204);
      expect(postReport.headers['referrer-policy']).toBe('no-referrer');
      expect(postReport.headers['cache-control']).toBe('no-store');

      const acceptWithoutSession = await request(app)
        .post(`/api/v1/public/team-invites/${'e'.repeat(40)}/accept`)
        .set('X-Forwarded-For', '198.51.100.53');

      expect(acceptWithoutSession.status).toBe(401);
      expect(acceptWithoutSession.headers['referrer-policy']).toBe('no-referrer');
      expect(acceptWithoutSession.headers['cache-control']).toBe('no-store');
    });

    it('não devolve o token em mensagens de erro', async () => {
      const token = 'z'.repeat(40);
      const responses = [
        await request(app)
          .get(`/api/v1/public/team-invites/${token}`)
          .set('X-Forwarded-For', '198.51.100.60'),
        await request(app)
          .get(`/api/v1/public/team-invites/${token}/report`)
          .set('X-Forwarded-For', '198.51.100.61'),
        await request(app)
          .post(`/api/v1/public/team-invites/${token}/accept`)
          .set('X-Forwarded-For', '198.51.100.62'),
        await request(app)
          .get(`/api/v1/public/team-invites/${token}/rota-inexistente`)
          .set('X-Forwarded-For', '198.51.100.63'),
      ];

      for (const response of responses) {
        expect(JSON.stringify(response.body)).not.toContain(token);
      }
    });

    it('só revoga o convite no POST de denúncia, nunca no GET', async () => {
      const before = await pool.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM team_invites WHERE id = $1`,
        [pendingInviteId]
      );
      expect(before.rows[0]!.revoked_at).toBeNull();

      const getResponse = await request(app)
        .get(`/api/v1/public/team-invites/${pendingInviteToken}/report`)
        .set('X-Forwarded-For', '198.51.100.20');

      expect(getResponse.status).toBe(405);
      expect(getResponse.headers.allow).toBe('POST');

      const afterGet = await pool.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM team_invites WHERE id = $1`,
        [pendingInviteId]
      );
      expect(afterGet.rows[0]!.revoked_at).toBeNull();

      const memberAfterGet = await pool.query<{ status: string }>(
        `SELECT status FROM team_members WHERE id = $1`,
        [pendingMemberId]
      );
      expect(memberAfterGet.rows[0]!.status).toBe('convite_pendente');

      const blocksAfterGet = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM team_invite_blocks
          WHERE host_id = $1 AND email = $2::citext`,
        [HOST_OWNER, EMAIL_PENDING]
      );
      expect(blocksAfterGet.rows[0]!.count).toBe(0);

      const postResponse = await request(app)
        .post(`/api/v1/public/team-invites/${pendingInviteToken}/report`)
        .set('X-Forwarded-For', '198.51.100.21');

      expect(postResponse.status).toBe(204);

      const afterPost = await pool.query<{ revoked_at: Date | null }>(
        `SELECT revoked_at FROM team_invites WHERE id = $1`,
        [pendingInviteId]
      );
      expect(afterPost.rows[0]!.revoked_at).not.toBeNull();

      const blocksAfterPost = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM team_invite_blocks
          WHERE host_id = $1 AND email = $2::citext`,
        [HOST_OWNER, EMAIL_PENDING]
      );
      expect(blocksAfterPost.rows[0]!.count).toBe(1);

      const deliveries = await pool.query<{ status: string }>(
        `SELECT status FROM email_deliveries
          WHERE message_type = 'team_invite' AND payload->>'inviteId' = $1`,
        [pendingInviteId]
      );
      expect(deliveries.rows.length).toBeGreaterThan(0);
      expect(deliveries.rows.every((row) => row.status === 'cancelled')).toBe(true);
    });
  }
);

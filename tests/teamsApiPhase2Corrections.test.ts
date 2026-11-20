import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Correções da Fase 2: regra única de conclusão/estado, despromoção,
 * compatibilidade com o cliente antigo, isolamento entre anfitriões e
 * casos-limite de membros.
 *
 * Corre contra uma CÓPIA já migrada, indicada por `TEAMS_API_TEST_URL`.
 * Os UUIDs são próprios deste ficheiro para poder correr em paralelo com
 * `teamsApi.test.ts` sem partilhar linhas.
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

const HOST_OWNER = 'a1111111-1111-4111-8111-111111111111';
const HOST_OTHER = 'a2222222-2222-4222-8222-222222222222';
const HOST_MANAGER = 'a3333333-3333-4333-8333-333333333333';
const HOST_MEMBER = 'a4444444-4444-4444-8444-444444444444';
const HOST_STRANGER = 'a5555555-5555-4555-8555-555555555555';
const HOST_MANAGER_2 = 'a6666666-6666-4666-8666-666666666666';
const HOST_MEMBER_2 = 'a7777777-7777-4777-8777-777777777777';

const EVENT_1 = 'b1111111-1111-4111-8111-111111111111';
const EVENT_1B = 'b2222222-2222-4222-8222-222222222222';
const EVENT_2 = 'b3333333-3333-4333-8333-333333333333';

const MANAGER_1 = 'c1111111-1111-4111-8111-111111111111';
const MANAGER_2 = 'c2222222-2222-4222-8222-222222222222';

const EMAIL_OWNER = 'fix-owner@exemplo.pt';
const EMAIL_OTHER = 'fix-other@exemplo.pt';
const EMAIL_MANAGER = 'fix-manager@exemplo.pt';
const EMAIL_MEMBER = 'fix-member@exemplo.pt';
const EMAIL_STRANGER = 'fix-stranger@exemplo.pt';
const EMAIL_MANAGER_2 = 'fix-manager-2@exemplo.pt';
const EMAIL_MEMBER_2 = 'fix-member-2@exemplo.pt';

const HOST_IDS = [
  HOST_OWNER,
  HOST_OTHER,
  HOST_MANAGER,
  HOST_MEMBER,
  HOST_STRANGER,
  HOST_MANAGER_2,
  HOST_MEMBER_2,
];
const EVENT_IDS = [EVENT_1, EVENT_1B, EVENT_2];

interface Scope {
  hostId: string;
  managerEmail: string | null;
}

const scopeOwner: Scope = { hostId: HOST_OWNER, managerEmail: EMAIL_OWNER };
const scopeOther: Scope = { hostId: HOST_OTHER, managerEmail: EMAIL_OTHER };
const scopeManager: Scope = { hostId: HOST_MANAGER, managerEmail: EMAIL_MANAGER };
const scopeMember: Scope = { hostId: HOST_MEMBER, managerEmail: EMAIL_MEMBER };
const scopeStranger: Scope = { hostId: HOST_STRANGER, managerEmail: EMAIL_STRANGER };
const scopeManager2: Scope = { hostId: HOST_MANAGER_2, managerEmail: EMAIL_MANAGER_2 };

type TeamService = typeof import('../src/services/team.service').teamService;
type TeamMemberService = typeof import('../src/services/teamMember.service').teamMemberService;
type TaskService = typeof import('../src/services/task.service').taskService;

describe.skipIf(!connectionString)('correções da Fase 2 (integração)', () => {
  let pool: import('pg').Pool;
  let teamService: TeamService;
  let teamMemberService: TeamMemberService;
  let taskService: TaskService;

  let teamAlpha: string;
  let teamBeta: string;
  let teamEvent1B: string;
  let teamEvent2: string;

  let hostMemberId: string;
  let managerMemberId: string;
  let memberMemberId: string;

  async function memberId(teamId: string, email: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members
        WHERE team_id = $1 AND email = $2::citext AND removed_at IS NULL`,
      [teamId, email]
    );
    return rows[0]?.id ?? '';
  }

  async function createTeam(eventId: string, name: string): Promise<string> {
    const team = await teamService.create(scopeOwner, {
      event_id: eventId,
      name,
      category: 'outra',
      description: null,
    });
    return team.id;
  }

  beforeAll(async () => {
    ({ pool } = await import('../src/database/pool'));
    ({ teamService } = await import('../src/services/team.service'));
    ({ teamMemberService } = await import('../src/services/teamMember.service'));
    ({ taskService } = await import('../src/services/task.service'));

    await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM invitations WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);

    await pool.query(
      `INSERT INTO hosts (id, email, password_hash, email_verified_at, status) VALUES
         ($1, $2, 'x', now(), 'active'),
         ($3, $4, 'x', now(), 'active'),
         ($5, $6, 'x', now(), 'active'),
         ($7, $8, 'x', now(), 'active'),
         ($9, $10, 'x', now(), 'active'),
         ($11, $12, 'x', now(), 'active'),
         ($13, $14, 'x', now(), 'active')`,
      [
        HOST_OWNER,
        EMAIL_OWNER,
        HOST_OTHER,
        EMAIL_OTHER,
        HOST_MANAGER,
        EMAIL_MANAGER,
        HOST_MEMBER,
        EMAIL_MEMBER,
        HOST_STRANGER,
        EMAIL_STRANGER,
        HOST_MANAGER_2,
        EMAIL_MANAGER_2,
        HOST_MEMBER_2,
        EMAIL_MEMBER_2,
      ]
    );

    await pool.query(
      `INSERT INTO host_profiles (host_id, display_name) VALUES
         ($1, 'Anfitriã Principal'),
         ($2, 'Outro Anfitrião'),
         ($3, 'Gestor Um'),
         ($4, 'Membro Um'),
         ($5, 'Estranho'),
         ($6, 'Gestor Dois'),
         ($7, 'Membro Dois')`,
      [HOST_OWNER, HOST_OTHER, HOST_MANAGER, HOST_MEMBER, HOST_STRANGER, HOST_MANAGER_2, HOST_MEMBER_2]
    );

    await pool.query(
      `INSERT INTO events (
         id, manage_token_hash, title, host_name, host_email, starts_at, status,
         host_id, location_type, location_name
       ) VALUES
         ($1, 'fix-hash-1', 'Evento Principal', 'Anfitriã Principal', $4,
          now() + interval '30 days', 'scheduled', $5, 'venue', 'Quinta 1'),
         ($2, 'fix-hash-1b', 'Evento Secundário', 'Anfitriã Principal', $4,
          now() + interval '40 days', 'scheduled', $5, 'venue', 'Quinta 1'),
         ($3, 'fix-hash-2', 'Evento Alheio', 'Outro Anfitrião', $6,
          now() + interval '50 days', 'scheduled', $7, 'venue', 'Quinta 2')`,
      [EVENT_1, EVENT_1B, EVENT_2, EMAIL_OWNER, HOST_OWNER, EMAIL_OTHER, HOST_OTHER]
    );

    await pool.query(
      `WITH new_team AS (
         INSERT INTO teams (event_id, name, category, description, deleted_at)
         VALUES ($2, 'Equipa do Gestor Um', 'outra', 'Equipa criada para testes.', now())
         RETURNING id
       )
       INSERT INTO event_managers (id, event_id, team_id, email)
       SELECT $1, $2, id, $3 FROM new_team`,
      [MANAGER_1, EVENT_1, EMAIL_MANAGER]
    );

    await pool.query(
      `WITH new_team AS (
         INSERT INTO teams (event_id, name, category, description, deleted_at)
         VALUES ($2, 'Equipa do Gestor Dois', 'outra', 'Equipa criada para testes.', now())
         RETURNING id
       )
       INSERT INTO event_managers (id, event_id, team_id, email)
       SELECT $1, $2, id, $3 FROM new_team`,
      [MANAGER_2, EVENT_1B, EMAIL_MANAGER_2]
    );

    teamAlpha = await createTeam(EVENT_1, 'Alpha');
    teamBeta = await createTeam(EVENT_1, 'Beta');
    teamEvent1B = await createTeam(EVENT_1B, 'Equipa 1B');
    teamEvent2 = (
      await teamService.create(scopeOther, {
        event_id: EVENT_2,
        name: 'Equipa 2',
        category: 'outra',
        description: null,
      })
    ).id;

    await teamMemberService.add(scopeOwner, teamAlpha, { emails: [EMAIL_MEMBER] });
    await teamMemberService.add(scopeOwner, teamEvent1B, { emails: [EMAIL_MEMBER_2] });

    hostMemberId = await memberId(teamAlpha, EMAIL_OWNER);
    managerMemberId = await memberId(teamAlpha, EMAIL_MANAGER);
    memberMemberId = await memberId(teamAlpha, EMAIL_MEMBER);

    expect(hostMemberId).not.toBe('');
    expect(managerMemberId).not.toBe('');
    expect(memberMemberId).not.toBe('');
  });

  afterAll(async () => {
    if (!pool) return;

    await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM invitations WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.end();
  });

  describe('regra única para done/status', () => {
    it('exige o responsável em PATCH, /status, criação concluída e move', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Tarefa da matriz',
        team_id: teamAlpha,
        assignee_member_id: memberMemberId,
        priority: 'normal',
        status: 'por_fazer',
      });

      // PATCH com `status`.
      await expect(
        taskService.update(scopeOwner, task.id, { status: 'concluida' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      // PATCH com alias `done`.
      await expect(
        taskService.update(scopeManager, task.id, { done: true })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      // Endpoint /status com a mensagem exacta do responsável.
      await expect(
        taskService.setStatus(scopeOwner, task.id, { status: 'concluida' })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'task_complete_forbidden',
        message: 'Só Membro Um pode concluir esta tarefa.',
      });

      // Reabrir e em_curso também são exclusivos do responsável.
      await expect(
        taskService.update(scopeOwner, task.id, { status: 'em_curso' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      // Criação já concluída em nome de outra pessoa.
      await expect(
        taskService.create(scopeOwner, {
          title: 'Concluída em nome do membro',
          team_id: teamAlpha,
          assignee_member_id: memberMemberId,
          priority: 'normal',
          status: 'concluida',
        })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      await expect(
        taskService.create(scopeOwner, {
          title: 'Concluída em nome do membro (alias)',
          team_id: teamAlpha,
          assignee_member_id: memberMemberId,
          priority: 'normal',
          done: true,
        })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      // Estranho: 404 em todos os caminhos, nunca 403.
      await expect(
        taskService.update(scopeStranger, task.id, { status: 'concluida' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'task_not_found' });

      await expect(
        taskService.setStatus(scopeStranger, task.id, { status: 'concluida' })
      ).rejects.toMatchObject({ statusCode: 404, code: 'task_not_found' });

      await expect(
        taskService.create(scopeStranger, {
          title: 'Intrusa',
          team_id: teamAlpha,
          priority: 'normal',
          status: 'concluida',
        })
      ).rejects.toMatchObject({ statusCode: 404, code: 'team_not_found' });

      await expect(
        taskService.move(scopeStranger, task.id, { team_id: teamBeta })
      ).rejects.toMatchObject({ statusCode: 404, code: 'task_not_found' });

      // O responsável conclui, reabre e muda para em_curso.
      const done = await taskService.update(scopeMember, task.id, { done: true });
      expect(done.status).toBe('concluida');
      expect(done.completedByMemberId).toBe(memberMemberId);

      // Reabrir também é exclusivo do responsável, mesmo para o gestor.
      await expect(
        taskService.update(scopeManager, task.id, { done: false })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      const reopened = await taskService.update(scopeMember, task.id, { done: false });
      expect(reopened.status).toBe('por_fazer');
      expect(reopened.completedAt).toBeNull();
      expect(reopened.completedByMemberId).toBeNull();

      const inProgress = await taskService.update(scopeMember, task.id, { status: 'em_curso' });
      expect(inProgress.status).toBe('em_curso');
      expect(inProgress.done).toBe(false);

      const doneAgain = await taskService.setStatus(scopeMember, task.id, {
        status: 'concluida',
      });
      expect(doneAgain.status).toBe('concluida');
      expect(doneAgain.done).toBe(true);
    });

    it('permite criar já concluída quando a conta é o responsável', async () => {
      const byMember = await taskService.create(scopeMember, {
        title: 'Concluída pelo próprio membro',
        team_id: teamAlpha,
        priority: 'normal',
        status: 'concluida',
      });

      expect(byMember.assigneeMemberId).toBe(memberMemberId);
      expect(byMember.completedByMemberId).toBe(memberMemberId);
      expect(byMember.completedAt).not.toBeNull();

      const byMemberAlias = await taskService.create(scopeMember, {
        title: 'Concluída pelo próprio membro (alias)',
        team_id: teamAlpha,
        priority: 'normal',
        done: true,
      });

      expect(byMemberAlias.status).toBe('concluida');
      expect(byMemberAlias.completedByMemberId).toBe(memberMemberId);

      const byHost = await taskService.create(scopeOwner, {
        title: 'Concluída pelo anfitrião',
        team_id: teamAlpha,
        priority: 'normal',
        status: 'concluida',
      });

      expect(byHost.assigneeMemberId).toBe(hostMemberId);
      expect(byHost.completedByMemberId).toBe(hostMemberId);

      const personal = await taskService.create(scopeOwner, {
        title: 'Pessoal já concluída',
        priority: 'normal',
        status: 'concluida',
      });

      expect(personal.teamId).toBeNull();
      expect(personal.completedAt).not.toBeNull();
      expect(personal.completedByMemberId).toBeNull();
    });

    it('duas conclusões simultâneas produzem uma só mudança e completed_at estável', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Conclusão concorrente por caminhos diferentes',
        team_id: teamAlpha,
        assignee_member_id: memberMemberId,
        priority: 'alta',
        status: 'por_fazer',
      });

      const [first, second] = await Promise.all([
        taskService.update(scopeMember, task.id, { done: true }),
        taskService.setStatus(scopeMember, task.id, { status: 'concluida' }),
      ]);

      expect(first.status).toBe('concluida');
      expect(second.status).toBe('concluida');
      expect(first.completedAt?.toISOString()).toBe(second.completedAt?.toISOString());
      expect(first.completedByMemberId).toBe(memberMemberId);

      const { rows } = await pool.query<{
        status: string;
        done: boolean;
        completed_by_member_id: string | null;
      }>(
        `SELECT status, done, completed_by_member_id
           FROM host_tasks WHERE id = $1`,
        [task.id]
      );

      expect(rows[0]).toEqual({
        status: 'concluida',
        done: true,
        completed_by_member_id: memberMemberId,
      });
    });

    it('mover uma tarefa concluída preserva a conclusão e não aceita estado no corpo', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Concluída antes de mudar de equipa',
        team_id: teamAlpha,
        assignee_member_id: memberMemberId,
        priority: 'normal',
        status: 'por_fazer',
      });

      const done = await taskService.setStatus(scopeMember, task.id, {
        status: 'concluida',
      });

      const moved = await taskService.move(scopeOwner, task.id, { team_id: teamBeta });

      expect(moved.teamId).toBe(teamBeta);
      expect(moved.status).toBe('concluida');
      expect(moved.done).toBe(true);
      expect(moved.completedAt?.toISOString()).toBe(done.completedAt?.toISOString());
      expect(moved.completedByMemberId).toBe(memberMemberId);

      const { moveTaskSchema } = await import('../src/schemas/team.schemas');
      expect(
        moveTaskSchema.safeParse({ team_id: teamBeta, status: 'por_fazer' }).success
      ).toBe(false);
    });
  });

  describe('cliente antigo: POST /host/tasks', () => {
    it('label + event_id sem equipa vai para a equipa Geral com o anfitrião', async () => {
      const task = await taskService.create(scopeOwner, {
        label: 'Tarefa do cliente antigo',
        event_id: EVENT_1B,
        priority: 'normal',
      });

      expect(task.teamId).not.toBeNull();
      expect(task.teamName).toBe('Geral');
      expect(task.eventId).toBe(EVENT_1B);
      expect(task.assigneeEmail).toBe(EMAIL_OWNER);

      const { rows } = await pool.query<{ email: string; is_host: boolean }>(
        `SELECT m.email, m.is_host
           FROM team_members m
          WHERE m.team_id = $1
          ORDER BY m.is_host DESC, m.email`,
        [task.teamId]
      );

      expect(rows.map((row) => row.email)).toContain(EMAIL_OWNER);
      expect(rows.map((row) => row.email)).toContain(EMAIL_MANAGER_2);
    });

    it('manager_id escolhe o gestor como responsável e sem evento continua pessoal', async () => {
      const managed = await taskService.create(scopeOwner, {
        label: 'Tarefa do gestor antigo',
        event_id: EVENT_1,
        manager_id: MANAGER_1,
        priority: 'normal',
      });

      expect(managed.teamName).toBe('Geral');
      expect(managed.eventId).toBe(EVENT_1);
      expect(managed.assigneeEmail).toBe(EMAIL_MANAGER);
      expect(managed.managerId).toBe(MANAGER_1);

      const byManager = await taskService.create(scopeManager, {
        label: 'Tarefa criada por um gestor',
        event_id: EVENT_1,
        priority: 'normal',
      });

      expect(byManager.teamName).toBe('Geral');
      expect(byManager.assigneeEmail).toBe(EMAIL_OWNER);

      const personal = await taskService.create(scopeOwner, {
        label: 'Tarefa pessoal antiga',
        event_id: null,
        manager_id: null,
        priority: 'normal',
      });

      expect(personal.teamId).toBeNull();
      expect(personal.eventId).toBeNull();
      expect(personal.assigneeMemberId).toBeNull();
    });
  });

  describe('papéis de equipa', () => {
    it('só o anfitrião promove e despromove; um gestor não mexe noutro gestor', async () => {
      const member2Id = await memberId(teamEvent1B, EMAIL_MEMBER_2);

      const promoted = await teamMemberService.updateRole(scopeOwner, teamEvent1B, member2Id, {
        role: 'gestor',
      });
      expect(promoted.member.role).toBe('gestor');
      expect(promoted.eventManagerId).not.toBeNull();

      await expect(
        teamMemberService.updateRole(scopeManager2, teamEvent1B, member2Id, {
          role: 'membro',
        })
      ).rejects.toMatchObject({ statusCode: 403, code: 'host_action_forbidden' });

      await expect(
        teamMemberService.updateRole(scopeMember, teamAlpha, managerMemberId, {
          role: 'membro',
        })
      ).rejects.toMatchObject({ statusCode: 403, code: 'host_action_forbidden' });

      const demoted = await teamMemberService.updateRole(scopeOwner, teamEvent1B, member2Id, {
        role: 'membro',
      });
      expect(demoted.member.role).toBe('membro');

      // A despromoção não revoga o acesso ao evento (decisão aprovada).
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM event_managers
          WHERE event_id = $1 AND email = $2 AND revoked_at IS NULL`,
        [EVENT_1B, EMAIL_MEMBER_2]
      );
      expect(rows[0]?.count).toBe('1');
    });

    it('não deixa adicionar a própria conta, deduplica maiúsculas/minúsculas e limita a 50', async () => {
      const self = await teamMemberService.add(scopeOwner, teamAlpha, {
        emails: [EMAIL_OWNER.toUpperCase()],
      });
      expect(self.skipped).toEqual([
        expect.objectContaining({ reason: 'self' }),
      ]);

      const duplicates = await teamMemberService.add(scopeOwner, teamBeta, {
        emails: ['Case@Exemplo.pt', 'case@exemplo.pt'],
      });
      expect(duplicates.pending).toHaveLength(1);
      expect(duplicates.skipped).toEqual([
        expect.objectContaining({ email: 'case@exemplo.pt', reason: 'duplicate_in_request' }),
      ]);

      const again = await teamMemberService.add(scopeOwner, teamBeta, {
        emails: ['CASE@exemplo.pt'],
      });
      expect(again.skipped).toEqual([
        expect.objectContaining({ email: 'case@exemplo.pt', reason: 'already_member' }),
      ]);

      const many = Array.from({ length: 51 }, (_, index) => `bulk-${index}@exemplo.pt`);

      const { addTeamMembersSchema } = await import('../src/schemas/team.schemas');
      expect(addTeamMembersSchema.safeParse({ emails: many }).success).toBe(true);

      await expect(
        teamMemberService.add(scopeOwner, teamAlpha, { emails: many })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'too_many_emails',
        message: 'Só pode adicionar até 50 emails por pedido.',
      });
    });

    it('apagar equipa com tarefas abertas devolve 409 e confirmação faz soft delete', async () => {
      const temp = await createTeam(EVENT_1B, 'Equipa Temporária');
      const task = await taskService.create(scopeOwner, {
        title: 'Tarefa aberta da equipa temporária',
        team_id: temp,
        priority: 'normal',
        status: 'por_fazer',
      });

      const error = await teamService
        .remove(scopeOwner, temp, {})
        .catch((err: unknown) => err);

      expect(error).toMatchObject({ statusCode: 409, code: 'team_has_open_tasks' });
      expect((error as { details?: { tasks: unknown[] } }).details?.tasks).toHaveLength(1);

      const result = await teamService.remove(scopeOwner, temp, {
        confirm: true,
        archive: true,
      });
      expect(result.archivedTasks).toBe(1);

      const { rows } = await pool.query<{
        deleted_at: Date | null;
        archived_at: Date | null;
      }>(
        `SELECT t.deleted_at, ht.archived_at
           FROM teams t
           JOIN host_tasks ht ON ht.team_id = t.id
          WHERE t.id = $1 AND ht.id = $2`,
        [temp, task.id]
      );

      expect(rows[0]?.deleted_at).not.toBeNull();
      expect(rows[0]?.archived_at).not.toBeNull();

      await expect(teamService.get(scopeOwner, temp)).rejects.toMatchObject({
        statusCode: 404,
        code: 'team_not_found',
      });
    });

    it('gestor revogado fica sem acesso e só o anfitrião/gestor reatribui', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Tarefa do gestor revogado',
        team_id: teamAlpha,
        assignee_member_id: managerMemberId,
        priority: 'normal',
        status: 'por_fazer',
      });

      await pool.query(
        `UPDATE event_managers SET revoked_at = now() WHERE id = $1`,
        [MANAGER_1]
      );

      const list = await taskService.list(scopeOwner, {
        team_id: teamAlpha,
        status: 'all',
        assignee: 'all',
        page: 1,
        page_size: 100,
      });
      const listed = list.items.find((row) => row.id === task.id);
      expect(listed?.assigneeHasAccess).toBe(false);

      await expect(
        taskService.reassign(scopeManager, task.id, {
          assignee_member_id: memberMemberId,
        })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_reassign_forbidden' });

      const reassigned = await taskService.reassign(scopeOwner, task.id, {
        assignee_member_id: memberMemberId,
      });
      expect(reassigned.assigneeMemberId).toBe(memberMemberId);

      await pool.query(
        `UPDATE event_managers SET revoked_at = NULL WHERE id = $1`,
        [MANAGER_1]
      );

      const byManager = await taskService.reassign(scopeManager, task.id, {
        assignee_member_id: hostMemberId,
      });
      expect(byManager.assigneeMemberId).toBe(hostMemberId);
    });
  });

  describe('isolamento e visibilidade', () => {
    it('GET /host/teams mostra tudo só nos eventos onde a conta é anfitriã ou gestora', async () => {
      const owner = await teamService.list(scopeOwner, { page: 1, page_size: 100 });
      const ownerIds = owner.items.map((team) => team.id);
      expect(ownerIds).toEqual(expect.arrayContaining([teamAlpha, teamBeta, teamEvent1B]));
      expect(ownerIds).not.toContain(teamEvent2);

      const manager = await teamService.list(scopeManager, { page: 1, page_size: 100 });
      const managerIds = manager.items.map((team) => team.id);
      expect(managerIds).toEqual(expect.arrayContaining([teamAlpha, teamBeta]));
      expect(managerIds).not.toContain(teamEvent1B);
      expect(managerIds).not.toContain(teamEvent2);

      const member = await teamService.list(scopeMember, { page: 1, page_size: 100 });
      expect(member.items.map((team) => team.id)).toEqual([teamAlpha]);

      const other = await teamService.list(scopeOther, { page: 1, page_size: 100 });
      expect(other.items.map((team) => team.id)).toEqual([teamEvent2]);
    });

    it('ids forçados de outro anfitrião devolvem 404 e as listas não vazam dados', async () => {
      await expect(
        teamService.list(scopeOwner, { event_id: EVENT_2, page: 1, page_size: 20 })
      ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });

      await expect(
        teamService.list(scopeManager, { event_id: EVENT_1B, page: 1, page_size: 20 })
      ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });

      await expect(
        teamService.list(scopeOther, { event_id: EVENT_1, page: 1, page_size: 20 })
      ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });

      await expect(teamService.get(scopeOther, teamAlpha)).rejects.toMatchObject({
        statusCode: 404,
        code: 'team_not_found',
      });

      await expect(
        taskService.list(scopeOther, {
          event_id: EVENT_1,
          status: 'all',
          assignee: 'all',
          page: 1,
          page_size: 20,
        })
      ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });

      await expect(
        taskService.list(scopeOther, {
          team_id: teamAlpha,
          status: 'all',
          assignee: 'all',
          page: 1,
          page_size: 20,
        })
      ).rejects.toMatchObject({ statusCode: 404, code: 'team_not_found' });

      await expect(
        taskService.list(scopeOwner, {
          team_id: teamEvent2,
          status: 'all',
          assignee: 'all',
          page: 1,
          page_size: 20,
        })
      ).rejects.toMatchObject({ statusCode: 404, code: 'team_not_found' });

      const otherTasks = await taskService.list(scopeOther, {
        status: 'all',
        assignee: 'all',
        page: 1,
        page_size: 100,
      });
      const otherTeamIds = new Set(
        (await pool.query<{ id: string }>(`SELECT id FROM teams WHERE event_id = $1`, [EVENT_1]))
          .rows.map((row) => row.id)
      );
      expect(otherTasks.items.every((task) => !task.teamId || !otherTeamIds.has(task.teamId))).toBe(
        true
      );

      const filteredByManager = await taskService.list(scopeOther, {
        assignee_member_id: managerMemberId,
        status: 'all',
        assignee: 'all',
        page: 1,
        page_size: 100,
      });
      expect(filteredByManager.items).toEqual([]);

      const searched = await taskService.list(scopeOther, {
        q: 'Tarefa',
        status: 'all',
        assignee: 'all',
        page: 1,
        page_size: 100,
      });
      expect(searched.items.every((task) => !task.teamId || !otherTeamIds.has(task.teamId))).toBe(
        true
      );
    });

    it('membro autor edita campos mas não o responsável nem o estado', async () => {
      const task = await taskService.create(scopeMember, {
        title: 'Tarefa criada pelo membro',
        team_id: teamAlpha,
        priority: 'baixa',
        status: 'por_fazer',
      });

      // O anfitrião reatribui para si; o membro continua a ser o autor.
      await taskService.reassign(scopeOwner, task.id, {
        assignee_member_id: hostMemberId,
      });

      const updated = await taskService.update(scopeMember, task.id, {
        title: 'Título alterado pelo autor',
        description: 'Descrição alterada pelo autor',
        due_date: '2030-01-31',
        priority: 'alta',
      });

      expect(updated.title).toBe('Título alterado pelo autor');
      expect(updated.description).toBe('Descrição alterada pelo autor');
      // `pg` devolve colunas `date` como `Date` no fuso local.
      const due = updated.dueDate as unknown as Date;
      const dueIso = [
        due.getFullYear(),
        String(due.getMonth() + 1).padStart(2, '0'),
        String(due.getDate()).padStart(2, '0'),
      ].join('-');
      expect(dueIso).toBe('2030-01-31');
      expect(updated.priority).toBe('alta');
      expect(updated.assigneeMemberId).toBe(hostMemberId);
      expect(updated.status).toBe('por_fazer');

      await expect(
        taskService.update(scopeMember, task.id, { status: 'concluida' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      await expect(
        taskService.update(scopeMember, task.id, { done: true })
      ).rejects.toMatchObject({ statusCode: 403, code: 'task_complete_forbidden' });

      const { updateTaskSchema } = await import('../src/schemas/host.schemas');
      expect(
        updateTaskSchema.safeParse({ assignee_member_id: memberMemberId }).success
      ).toBe(false);
    });

    it('sincroniza status e done nos dois sentidos também através dos aliases', async () => {
      const task = await taskService.create(scopeOwner, {
        title: 'Sincronização pelos aliases',
        team_id: teamAlpha,
        assignee_member_id: memberMemberId,
        priority: 'normal',
        status: 'por_fazer',
      });

      const done = await taskService.update(scopeMember, task.id, { done: true });
      expect(done.status).toBe('concluida');
      expect(done.done).toBe(true);

      const reopened = await taskService.update(scopeMember, task.id, { done: false });
      expect(reopened.status).toBe('por_fazer');
      expect(reopened.done).toBe(false);
      expect(reopened.completedAt).toBeNull();

      const inProgress = await taskService.setStatus(scopeMember, task.id, {
        status: 'em_curso',
      });
      expect(inProgress.done).toBe(false);

      const doneByStatus = await taskService.setStatus(scopeMember, task.id, {
        status: 'concluida',
      });
      expect(doneByStatus.done).toBe(true);

      // O trigger não inventa o autor quando a coluna é alterada por SQL.
      await pool.query(
        `UPDATE host_tasks
            SET done = false, completed_at = NULL, completed_by_member_id = NULL
          WHERE id = $1`,
        [task.id]
      );
      await pool.query(`UPDATE host_tasks SET done = true WHERE id = $1`, [task.id]);

      const { rows } = await pool.query<{
        status: string;
        completed_by_member_id: string | null;
        completed_at: Date | null;
      }>(
        `SELECT status, completed_by_member_id, completed_at
           FROM host_tasks WHERE id = $1`,
        [task.id]
      );

      expect(rows[0]?.status).toBe('concluida');
      expect(rows[0]?.completed_by_member_id).toBeNull();
      expect(rows[0]?.completed_at).not.toBeNull();
    });
  });
});

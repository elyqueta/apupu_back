import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Testes de integração da Fase 2 (equipas, membros e tarefas).
 *
 * Só correm quando `TEAMS_API_TEST_URL` aponta para uma CÓPIA da base
 * de dados já migrada. Nunca tocam na base de desenvolvimento: o URL é
 * imposto antes de importar o pool da aplicação.
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

const HOST_A = 'eeeeeeee-0000-4000-8000-000000000001';
const HOST_B = 'eeeeeeee-0000-4000-8000-000000000002';
const HOST_MANAGER = 'eeeeeeee-0000-4000-8000-000000000003';
const HOST_OUTSIDER = 'eeeeeeee-0000-4000-8000-000000000004';

const EVENT_A = 'f0000000-0000-4000-8000-000000000001';
const EVENT_A2 = 'f0000000-0000-4000-8000-000000000002';
const EVENT_B = 'f0000000-0000-4000-8000-000000000003';

const MANAGER_ID = 'ab000000-0000-4000-8000-000000000001';

const EMAIL_A = 'api-host-a@exemplo.pt';
const EMAIL_B = 'api-host-b@exemplo.pt';
const EMAIL_MANAGER = 'api-manager@exemplo.pt';
const EMAIL_OUTSIDER = 'api-outsider@exemplo.pt';

const HOST_IDS = [HOST_A, HOST_B, HOST_MANAGER, HOST_OUTSIDER];
const EVENT_IDS = [EVENT_A, EVENT_A2, EVENT_B];

interface Scope {
  hostId: string;
  managerEmail: string | null;
}

const scopeA: Scope = { hostId: HOST_A, managerEmail: EMAIL_A };
const scopeB: Scope = { hostId: HOST_B, managerEmail: EMAIL_B };
const scopeManager: Scope = { hostId: HOST_MANAGER, managerEmail: EMAIL_MANAGER };
const scopeOutsider: Scope = { hostId: HOST_OUTSIDER, managerEmail: EMAIL_OUTSIDER };

type TeamService = typeof import('../src/services/team.service').teamService;
type TeamMemberService = typeof import('../src/services/teamMember.service').teamMemberService;
type TaskService = typeof import('../src/services/task.service').taskService;
type HostGuestService = typeof import('../src/services/hostGuest.service').hostGuestService;

describe.skipIf(!connectionString)('equipas, membros e tarefas (integração)', () => {
  let pool: import('pg').Pool;
  let teamService: TeamService;
  let teamMemberService: TeamMemberService;
  let taskService: TaskService;
  let hostGuestService: HostGuestService;

  let teamCozinha: string;
  let teamSala: string;
  let outsiderMemberId: string;

  beforeAll(async () => {
    ({ pool } = await import('../src/database/pool'));
    ({ teamService } = await import('../src/services/team.service'));
    ({ teamMemberService } = await import('../src/services/teamMember.service'));
    ({ taskService } = await import('../src/services/task.service'));
    ({ hostGuestService } = await import('../src/services/hostGuest.service'));

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
         ($7, $8, 'x', now(), 'active')`,
      [HOST_A, EMAIL_A, HOST_B, EMAIL_B, HOST_MANAGER, EMAIL_MANAGER, HOST_OUTSIDER, EMAIL_OUTSIDER]
    );

    await pool.query(
      `INSERT INTO host_profiles (host_id, display_name) VALUES
         ($1, 'Anfitriã A'), ($2, 'Anfitrião B'),
         ($3, 'Gestor M'), ($4, 'Externo X')`,
      [HOST_A, HOST_B, HOST_MANAGER, HOST_OUTSIDER]
    );

    await pool.query(
      `INSERT INTO events (
         id, manage_token_hash, title, host_name, host_email, starts_at, status,
         host_id, location_type, location_name
       ) VALUES
         ($1, 'api-hash-a', 'Evento A', 'Anfitriã A', $4, now() + interval '30 days',
          'scheduled', $7, 'venue', 'Quinta A'),
         ($2, 'api-hash-a2', 'Evento A2', 'Anfitriã A', $4, now() + interval '40 days',
          'scheduled', $7, 'venue', 'Quinta A'),
         ($3, 'api-hash-b', 'Evento B', 'Anfitrião B', $5, now() + interval '50 days',
          'scheduled', $6, 'venue', 'Quinta B')`,
      [EVENT_A, EVENT_A2, EVENT_B, EMAIL_A, EMAIL_B, HOST_B, HOST_A]
    );

    await pool.query(
      `WITH new_team AS (
         INSERT INTO teams (event_id, name, category, description, deleted_at)
         VALUES ($2, 'Equipa do Gestor API', 'outra', 'Equipa criada para testes.', now())
         RETURNING id
       )
       INSERT INTO event_managers (id, event_id, team_id, email)
       SELECT $1, $2, id, $3 FROM new_team`,
      [MANAGER_ID, EVENT_A, EMAIL_MANAGER]
    );

    await pool.query(
      `INSERT INTO invitations (
         event_id, guest_name, guest_email, token_hash, token_encrypted, link_expires_at
       ) VALUES
         ($1, 'Convidado Um', 'guest1@exemplo.pt', 'api-inv-1', 'x', now() + interval '1 day'),
         ($1, 'Convidado Um Duplicado', 'GUEST1@exemplo.pt', 'api-inv-1b', 'x', now() + interval '1 day'),
         ($1, 'Convidado Dois', 'guest2@exemplo.pt', 'api-inv-2', 'x', now() + interval '1 day'),
         ($1, 'Convidado Sem Email', '', 'api-inv-3', 'x', now() + interval '1 day'),
         ($2, 'Convidado A2', 'guest4@exemplo.pt', 'api-inv-4', 'x', now() + interval '1 day'),
         ($3, 'Convidado B', 'guestb@exemplo.pt', 'api-inv-b', 'x', now() + interval '1 day')`,
      [EVENT_A, EVENT_A2, EVENT_B]
    );

    teamCozinha = (
      await teamService.create(scopeA, {
        event_id: EVENT_A,
        name: 'Cozinha',
        category: 'catering',
        description: null,
      })
    ).id;

    teamSala = (
      await teamService.create(scopeA, {
        event_id: EVENT_A,
        name: 'Sala',
        category: 'decoracao',
        description: null,
      })
    ).id;
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

  it('materializa o anfitrião e o gestor activo como membros', async () => {
    const { rows } = await pool.query<{ email: string; is_host: boolean; role: string }>(
      `SELECT email, is_host, role FROM team_members
        WHERE team_id = $1 ORDER BY is_host DESC, email`,
      [teamCozinha]
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ email: EMAIL_A, is_host: true, role: 'gestor' });
    expect(rows[1]).toMatchObject({ email: EMAIL_MANAGER, is_host: false, role: 'gestor' });
  });

  it('um membro só vê os membros das suas equipas e não pode gerir equipas', async () => {
    const added = await teamMemberService.add(scopeA, teamCozinha, {
      emails: ['guest1@exemplo.pt', EMAIL_OUTSIDER],
    });

    // `guest1@exemplo.pt` ainda não tem conta: fica pendente.
    expect(added.added.map((row) => row.email)).toEqual([EMAIL_OUTSIDER]);
    expect(added.pending.map((row) => row.email)).toEqual(['guest1@exemplo.pt']);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members
        WHERE team_id = $1 AND email = $2 AND removed_at IS NULL`,
      [teamCozinha, EMAIL_OUTSIDER]
    );
    outsiderMemberId = rows[0]?.id ?? '';
    expect(outsiderMemberId).not.toBe('');

    const list = await teamService.list(scopeOutsider, { page: 1, page_size: 20 });
    expect(list.items.map((team) => team.id)).toEqual([teamCozinha]);

    // O membro vê os membros da sua equipa, mas não os de outra equipa
    // do mesmo evento nem os de qualquer outro evento.
    const members = await teamMemberService.list(scopeOutsider, teamCozinha, {
      page: 1,
      page_size: 20,
    });
    expect(members.items.map((member) => member.id)).toContain(outsiderMemberId);
    await expect(teamService.get(scopeOutsider, teamSala)).rejects.toMatchObject({
      statusCode: 404,
      code: 'team_not_found',
    });
    await expect(
      teamMemberService.list(scopeOutsider, teamSala, { page: 1, page_size: 20 })
    ).rejects.toMatchObject({ statusCode: 404, code: 'team_not_found' });

    await expect(
      teamService.create(scopeOutsider, {
        event_id: EVENT_A,
        name: 'Proibida',
        category: 'outra',
        description: null,
      })
    ).rejects.toMatchObject({ code: 'team_action_forbidden' });
  });

  it('devolve 404 (nunca 403) para equipas de eventos sem acesso', async () => {
    await expect(teamService.get(scopeB, teamCozinha)).rejects.toMatchObject({
      statusCode: 404,
      code: 'team_not_found',
    });

    await expect(teamService.get(scopeOutsider, teamSala)).rejects.toMatchObject({
      statusCode: 404,
      code: 'team_not_found',
    });

    await expect(
      teamService.create(scopeOutsider, {
        event_id: EVENT_B,
        name: 'Intrusa',
        category: 'outra',
        description: null,
      })
    ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });
  });

  it('qualquer membro cria tarefas; só o responsável conclui', async () => {
    const task = await taskService.create(scopeOutsider, {
      title: 'Comprar gelo',
      team_id: teamCozinha,
      priority: 'normal',
      status: 'por_fazer',
    });

    expect(task.teamId).toBe(teamCozinha);
    expect(task.assigneeMemberId).toBe(outsiderMemberId);
    expect(task.status).toBe('por_fazer');

    await expect(
      taskService.setStatus(scopeA, task.id, { status: 'concluida' })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'task_complete_forbidden',
      message: 'Só Externo X pode concluir esta tarefa.',
    });

    const done = await taskService.setStatus(scopeOutsider, task.id, { status: 'concluida' });
    expect(done.status).toBe('concluida');
    expect(done.completedAt).not.toBeNull();
    expect(done.completedByMemberId).toBe(outsiderMemberId);
  });

  it('não sobrescreve completed_at em conclusões concorrentes', async () => {
    const task = await taskService.create(scopeA, {
      title: 'Fechar contrato',
      team_id: teamCozinha,
      assignee_member_id: outsiderMemberId,
      priority: 'alta',
      status: 'por_fazer',
    });

    const [first, second] = await Promise.all([
      taskService.setStatus(scopeOutsider, task.id, { status: 'concluida' }),
      taskService.setStatus(scopeOutsider, task.id, { status: 'concluida' }),
    ]);

    expect(first.status).toBe('concluida');
    expect(second.status).toBe('concluida');
    expect(first.completedAt?.toISOString()).toBe(second.completedAt?.toISOString());

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_tasks
        WHERE id = $1 AND status = 'concluida' AND done = true`,
      [task.id]
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('o trigger sincroniza status e done nos dois sentidos', async () => {
    const task = await taskService.create(scopeA, {
      title: 'Tarefa de trigger',
      team_id: teamCozinha,
      priority: 'normal',
      status: 'por_fazer',
    });

    await pool.query(`UPDATE host_tasks SET status = 'concluida' WHERE id = $1`, [task.id]);
    let { rows } = await pool.query<{ done: boolean; completed_at: Date | null }>(
      'SELECT done, completed_at FROM host_tasks WHERE id = $1',
      [task.id]
    );
    expect(rows[0]?.done).toBe(true);
    expect(rows[0]?.completed_at).not.toBeNull();

    await pool.query(`UPDATE host_tasks SET status = 'por_fazer' WHERE id = $1`, [task.id]);
    ({ rows } = await pool.query<{ done: boolean; completed_at: Date | null }>(
      'SELECT done, completed_at FROM host_tasks WHERE id = $1',
      [task.id]
    ));
    expect(rows[0]?.done).toBe(false);
    expect(rows[0]?.completed_at).toBeNull();
  });

  it('um membro não edita tarefas que não criou, mas o anfitrião edita', async () => {
    const task = await taskService.create(scopeA, {
      title: 'Tarefa do anfitrião',
      team_id: teamCozinha,
      assignee_member_id: outsiderMemberId,
      priority: 'normal',
      status: 'por_fazer',
    });

    await expect(
      taskService.update(scopeOutsider, task.id, { title: 'Alterada' })
    ).rejects.toMatchObject({ code: 'task_edit_forbidden' });

    const updated = await taskService.update(scopeA, task.id, { title: 'Alterada pelo anfitrião' });
    expect(updated.title).toBe('Alterada pelo anfitrião');
    expect(updated.label).toBe('Alterada pelo anfitrião');
  });

  it('só o anfitrião/gestor reatribui tarefas', async () => {
    const task = await taskService.create(scopeA, {
      title: 'Tarefa para reatribuir',
      team_id: teamCozinha,
      assignee_member_id: outsiderMemberId,
      priority: 'normal',
      status: 'por_fazer',
    });

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE team_id = $1 AND is_host AND removed_at IS NULL`,
      [teamCozinha]
    );
    const hostMemberId = rows[0]?.id ?? '';

    await expect(
      taskService.reassign(scopeOutsider, task.id, { assignee_member_id: hostMemberId })
    ).rejects.toMatchObject({ code: 'task_reassign_forbidden' });

    const reassigned = await taskService.reassign(scopeA, task.id, {
      assignee_member_id: hostMemberId,
    });
    expect(reassigned.assigneeMemberId).toBe(hostMemberId);
  });

  it('promover a gestor é exclusivo do anfitrião e cria acesso ao evento', async () => {
    await expect(
      teamMemberService.updateRole(scopeManager, teamCozinha, outsiderMemberId, {
        role: 'gestor',
      })
    ).rejects.toMatchObject({ code: 'host_action_forbidden' });

    const promoted = await teamMemberService.updateRole(scopeA, teamCozinha, outsiderMemberId, {
      role: 'gestor',
    });

    expect(promoted.member.role).toBe('gestor');
    expect(promoted.eventManagerId).not.toBeNull();

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM event_managers
        WHERE event_id = $1 AND email = $2 AND revoked_at IS NULL`,
      [EVENT_A, EMAIL_OUTSIDER]
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('o anfitrião nunca é removido nem despromovido', async () => {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE team_id = $1 AND is_host`,
      [teamCozinha]
    );
    const hostMemberId = rows[0]?.id ?? '';

    await expect(
      teamMemberService.updateRole(scopeA, teamCozinha, hostMemberId, { role: 'membro' })
    ).rejects.toMatchObject({ code: 'host_member_immutable' });

    await expect(
      teamMemberService.remove(scopeA, teamCozinha, hostMemberId, {})
    ).rejects.toMatchObject({ code: 'host_member_immutable' });
  });

  it('remover membro com tarefas abertas devolve 409 e permite reatribuir', async () => {
    const task = await taskService.create(scopeA, {
      title: 'Tarefa aberta do membro',
      team_id: teamCozinha,
      assignee_member_id: outsiderMemberId,
      priority: 'normal',
      status: 'por_fazer',
    });

    const error = await teamMemberService
      .remove(scopeA, teamCozinha, outsiderMemberId, {})
      .catch((err: unknown) => err);

    expect(error).toMatchObject({
      statusCode: 409,
      code: 'member_has_open_tasks',
    });
    const openTasks = (error as { details?: { tasks: { id: string }[] } }).details?.tasks ?? [];
    expect(openTasks.map((row) => row.id)).toContain(task.id);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members WHERE team_id = $1 AND is_host`,
      [teamCozinha]
    );
    const hostMemberId = rows[0]?.id ?? '';

    const result = await teamMemberService.remove(scopeA, teamCozinha, outsiderMemberId, {
      reassign_to_member_id: hostMemberId,
    });

    expect(result.removed).toBe(true);
    expect(result.reassignedTasks).toBe(openTasks.length);

    const moved = await taskService.list(scopeA, {
      team_id: teamCozinha,
      assignee_member_id: hostMemberId,
      status: 'all',
      assignee: 'all',
      page: 1,
      page_size: 20,
    });
    expect(moved.items.some((row) => row.id === task.id)).toBe(true);
  });

  it('remover equipa com tarefas abertas exige confirmação e arquiva', async () => {
    const temp = await teamService.create(scopeA, {
      event_id: EVENT_A,
      name: 'Temporária',
      category: 'outra',
      description: null,
    });

    const task = await taskService.create(scopeA, {
      title: 'Tarefa da equipa temporária',
      team_id: temp.id,
      priority: 'normal',
      status: 'por_fazer',
    });

    const error = await teamService
      .remove(scopeA, temp.id, {})
      .catch((err: unknown) => err);

    expect(error).toMatchObject({ statusCode: 409, code: 'team_has_open_tasks' });
    expect((error as { details?: { tasks: unknown[] } }).details?.tasks).toHaveLength(1);

    const result = await teamService.remove(scopeA, temp.id, { confirm: true, archive: true });
    expect(result.archivedTasks).toBe(1);

    const { rows } = await pool.query<{ archived_at: Date | null }>(
      'SELECT archived_at FROM host_tasks WHERE id = $1',
      [task.id]
    );
    expect(rows[0]?.archived_at).not.toBeNull();
  });

  it('tarefas pessoais legadas só são visíveis ao criador e podem ser movidas', async () => {
    const personal = await taskService.create(scopeA, {
      title: 'Ligar à avó',
      priority: 'normal',
      status: 'por_fazer',
    });

    expect(personal.teamId).toBeNull();
    expect(personal.eventId).toBeNull();

    const hostList = await taskService.list(scopeA, {
      personal: true,
      status: 'all',
      assignee: 'all',
      page: 1,
      page_size: 20,
    });
    expect(hostList.items.map((row) => row.id)).toContain(personal.id);

    const managerList = await taskService.list(scopeManager, {
      personal: true,
      status: 'all',
      assignee: 'all',
      page: 1,
      page_size: 20,
    });
    expect(managerList.items.map((row) => row.id)).not.toContain(personal.id);

    const moved = await taskService.move(scopeA, personal.id, { team_id: teamSala });
    expect(moved.teamId).toBe(teamSala);
    expect(moved.assigneeMemberId).not.toBeNull();
  });

  it('a lista de candidatos de uma equipa respeita a privacidade dos eventos', async () => {
    const asHost = await hostGuestService.list(scopeA, {
      for_team: teamCozinha,
      page: 1,
      page_size: 50,
    });

    if (asHost.mode !== 'team') throw new Error('Esperava candidatos de equipa.');
    const hostEmails = asHost.items.map((row) => row.guestEmail.toLowerCase());
    expect(hostEmails).toContain('guest1@exemplo.pt');
    expect(hostEmails).toContain('guest2@exemplo.pt');
    expect(hostEmails).toContain('guest4@exemplo.pt');
    expect(hostEmails).not.toContain('guestb@exemplo.pt');
    expect(hostEmails.filter((email) => email === 'guest1@exemplo.pt')).toHaveLength(1);
    expect(asHost.items.find((row) => row.guestEmail === '')?.hasEmail).toBe(false);
    expect(
      asHost.items.find((row) => row.guestEmail.toLowerCase() === 'guest1@exemplo.pt')?.isMember
    ).toBe(true);

    const asManager = await hostGuestService.list(scopeManager, {
      for_team: teamCozinha,
      page: 1,
      page_size: 50,
    });

    if (asManager.mode !== 'team') throw new Error('Esperava candidatos de equipa.');
    const managerEmails = asManager.items.map((row) => row.guestEmail.toLowerCase());
    expect(managerEmails).toContain('guest2@exemplo.pt');
    expect(managerEmails).not.toContain('guest4@exemplo.pt');
    expect(managerEmails).not.toContain('guestb@exemplo.pt');
  });
});

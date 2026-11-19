import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toTeamDto } from '../src/dto/team.dto';

/**
 * Passo 0 da Fase 4: campos derivados e filtros da lista de equipas.
 *
 * Cobre `my_role`, `event_status`, filtros combinados no servidor,
 * paginação coerente, semântica de `mine` e isolamento entre
 * anfitriões. Corre contra uma CÓPIA migrada (`TEAMS_API_TEST_URL`).
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

const HOST_OWNER = 'e1111111-1111-4111-8111-111111111111';
const HOST_OTHER = 'e2222222-2222-4222-8222-222222222222';
const HOST_MANAGER = 'e3333333-3333-4333-8333-333333333333';
const HOST_MEMBER = 'e4444444-4444-4444-8444-444444444444';
const HOST_OTHER_MANAGER = 'e5555555-5555-4555-8555-555555555555';

const EVENT_FUTURE = 'f1111111-1111-4111-8111-111111111111';
const EVENT_LIVE = 'f2222222-2222-4222-8222-222222222222';
const EVENT_DONE = 'f3333333-3333-4333-8333-333333333333';
const EVENT_CANCELLED = 'f4444444-4444-4444-8444-444444444444';
const EVENT_DRAFT = 'f5555555-5555-4555-8555-555555555555';
const EVENT_OTHER = 'f6666666-6666-4666-8666-666666666666';
const EVENT_NO_END_DONE = 'f7777777-7777-4777-8777-777777777777';
const EVENT_NO_END_LIVE = 'f8888888-8888-4888-8888-888888888888';

const MANAGER_ID = 'c1111111-1111-4111-8111-111111111111';
const MANAGER_OTHER_ID = 'c2222222-2222-4222-8222-222222222222';

const EMAIL_OWNER = 'filters-owner@exemplo.pt';
const EMAIL_OTHER = 'filters-other@exemplo.pt';
const EMAIL_MANAGER = 'filters-manager@exemplo.pt';
const EMAIL_MEMBER = 'filters-member@exemplo.pt';
const EMAIL_OTHER_MANAGER = 'filters-other-manager@exemplo.pt';

const HOST_IDS = [HOST_OWNER, HOST_OTHER, HOST_MANAGER, HOST_MEMBER, HOST_OTHER_MANAGER];
const EVENT_IDS = [
  EVENT_FUTURE,
  EVENT_LIVE,
  EVENT_DONE,
  EVENT_CANCELLED,
  EVENT_DRAFT,
  EVENT_OTHER,
  EVENT_NO_END_DONE,
  EVENT_NO_END_LIVE,
];

interface Scope {
  hostId: string;
  managerEmail: string | null;
}

const scopeOwner: Scope = { hostId: HOST_OWNER, managerEmail: EMAIL_OWNER };
const scopeOther: Scope = { hostId: HOST_OTHER, managerEmail: EMAIL_OTHER };
const scopeManager: Scope = { hostId: HOST_MANAGER, managerEmail: EMAIL_MANAGER };
const scopeMember: Scope = { hostId: HOST_MEMBER, managerEmail: EMAIL_MEMBER };
const scopeOtherManager: Scope = {
  hostId: HOST_OTHER_MANAGER,
  managerEmail: EMAIL_OTHER_MANAGER,
};

type TeamService = typeof import('../src/services/team.service').teamService;
type TeamMemberService = typeof import('../src/services/teamMember.service').teamMemberService;
type TaskService = typeof import('../src/services/task.service').taskService;

function sorted(ids: string[]): string[] {
  return [...ids].sort();
}

describe.skipIf(!connectionString)('lista de equipas: campos e filtros (integração)', () => {
  let pool: import('pg').Pool;
  let teamService: TeamService;
  let teamMemberService: TeamMemberService;
  let taskService: TaskService;

  let teamCozinha: string;
  let teamSala: string;
  let teamMusica: string;
  let teamLogistica: string;
  let teamLive: string;
  let teamDone: string;
  let teamCancelled: string;
  let teamDraft: string;
  let teamOther: string;
  let teamNoEndDone: string;
  let teamNoEndLive: string;

  let managerMemberCozinha: string;

  async function memberOrder(teamId: string): Promise<string[]> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members
        WHERE team_id = $1 AND removed_at IS NULL
        ORDER BY created_at ASC, id ASC`,
      [teamId]
    );
    return rows.map((row) => row.id);
  }

  function expectPreviewSemEmails(
    preview: Array<{ id: string; display_name: string | null; avatar_url: string | null }>
  ): void {
    for (const member of preview) {
      expect(Object.keys(member).sort()).toEqual(['avatar_url', 'display_name', 'id']);
      expect(member.id).toBeTruthy();
    }
    // Nenhum email (de membro, anfitrião ou convidado) pode vazar no DTO.
    expect(JSON.stringify(preview)).not.toContain('@');
  }

  async function createTeam(
    scope: Scope,
    eventId: string,
    name: string,
    category:
      | 'logistica'
      | 'decoracao'
      | 'musica'
      | 'catering'
      | 'rececao'
      | 'outra'
  ): Promise<string> {
    const team = await teamService.create(scope, {
      event_id: eventId,
      name,
      category,
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
    await pool.query(
      `DELETE FROM team_invites
        WHERE team_id IN (SELECT id FROM teams WHERE event_id = ANY($1::uuid[]))`,
      [EVENT_IDS]
    );
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
         ($9, $10, 'x', now(), 'active')`,
      [
        HOST_OWNER,
        EMAIL_OWNER,
        HOST_OTHER,
        EMAIL_OTHER,
        HOST_MANAGER,
        EMAIL_MANAGER,
        HOST_MEMBER,
        EMAIL_MEMBER,
        HOST_OTHER_MANAGER,
        EMAIL_OTHER_MANAGER,
      ]
    );

    await pool.query(
      `INSERT INTO host_profiles (host_id, display_name) VALUES
         ($1, 'Anfitriã Principal'), ($2, 'Anfitrião Externo'),
         ($3, 'Gestor da Equipa'), ($4, 'Membro Convidado'),
         ($5, 'Gestor de Outro Evento')`,
      [HOST_OWNER, HOST_OTHER, HOST_MANAGER, HOST_MEMBER, HOST_OTHER_MANAGER]
    );

    await pool.query(
      `INSERT INTO events (
         id, manage_token_hash, title, host_name, host_email,
         starts_at, ends_at, status, host_id, location_type, location_name
       ) VALUES
         ($1, 'filters-future', 'Evento Futuro', 'Anfitriã Principal', $7,
          now() + interval '30 days', now() + interval '31 days',
          'scheduled', $9, 'venue', 'Quinta Futura'),
         ($2, 'filters-live', 'Evento a Decorrer', 'Anfitriã Principal', $7,
          now() - interval '1 hour', now() + interval '2 hours',
          'scheduled', $9, 'venue', 'Quinta Ao Vivo'),
         ($3, 'filters-done', 'Evento Terminado', 'Anfitriã Principal', $7,
          now() - interval '10 days', now() - interval '9 days',
          'scheduled', $9, 'venue', 'Quinta Antiga'),
         ($4, 'filters-cancelled', 'Evento Cancelado', 'Anfitriã Principal', $7,
          now() + interval '20 days', now() + interval '21 days',
          'cancelled', $9, 'venue', 'Quinta Cancelada'),
         ($5, 'filters-draft', 'Evento Rascunho', 'Anfitriã Principal', $7,
          now() + interval '25 days', now() + interval '26 days',
          'draft', $9, 'venue', 'Quinta Rascunho'),
         ($6, 'filters-other', 'Evento do Outro', 'Anfitrião Externo', $8,
          now() + interval '30 days', now() + interval '31 days',
          'scheduled', $10, 'venue', 'Quinta Externa'),
         ($11, 'filters-no-end-done', 'Evento Sem Fim Antigo', 'Anfitriã Principal', $7,
          now() - interval '2 days', NULL,
          'scheduled', $9, 'venue', 'Quinta Sem Fim'),
         ($12, 'filters-no-end-live', 'Evento Sem Fim Hoje', 'Anfitriã Principal', $7,
          now(), NULL,
          'scheduled', $9, 'venue', 'Quinta Sem Fim')`,
      [
        EVENT_FUTURE,
        EVENT_LIVE,
        EVENT_DONE,
        EVENT_CANCELLED,
        EVENT_DRAFT,
        EVENT_OTHER,
        EMAIL_OWNER,
        EMAIL_OTHER,
        HOST_OWNER,
        HOST_OTHER,
        EVENT_NO_END_DONE,
        EVENT_NO_END_LIVE,
      ]
    );

    await pool.query(
      `INSERT INTO event_managers (id, event_id, email) VALUES
         ($1, $2, $3), ($4, $5, $6)`,
      [
        MANAGER_ID,
        EVENT_FUTURE,
        EMAIL_MANAGER,
        MANAGER_OTHER_ID,
        EVENT_OTHER,
        EMAIL_OTHER_MANAGER,
      ]
    );

    teamCozinha = await createTeam(scopeOwner, EVENT_FUTURE, 'Cozinha', 'catering');
    teamSala = await createTeam(scopeOwner, EVENT_FUTURE, 'Sala', 'decoracao');
    teamMusica = await createTeam(scopeOwner, EVENT_FUTURE, 'Musica', 'musica');
    teamLogistica = await createTeam(scopeOwner, EVENT_FUTURE, 'Logistica', 'logistica');
    teamLive = await createTeam(scopeOwner, EVENT_LIVE, 'Equipa ao vivo', 'catering');
    teamDone = await createTeam(scopeOwner, EVENT_DONE, 'Equipa concluida', 'outra');
    teamCancelled = await createTeam(
      scopeOwner,
      EVENT_CANCELLED,
      'Equipa cancelada',
      'outra'
    );
    teamDraft = await createTeam(scopeOwner, EVENT_DRAFT, 'Equipa rascunho', 'outra');
    teamOther = await createTeam(scopeOther, EVENT_OTHER, 'Equipa alheia', 'catering');
    teamNoEndDone = await createTeam(
      scopeOwner,
      EVENT_NO_END_DONE,
      'Equipa sem fim antiga',
      'rececao'
    );
    teamNoEndLive = await createTeam(
      scopeOwner,
      EVENT_NO_END_LIVE,
      'Equipa sem fim de hoje',
      'rececao'
    );

    await teamMemberService.add(scopeOwner, teamSala, { emails: [EMAIL_MEMBER] });

    const managerRow = await pool.query<{ id: string }>(
      `SELECT id FROM team_members
        WHERE team_id = $1 AND email = $2::citext AND removed_at IS NULL`,
      [teamCozinha, EMAIL_MANAGER]
    );
    managerMemberCozinha = managerRow.rows[0]?.id ?? '';
    expect(managerMemberCozinha).not.toBe('');

    // Uma tarefa aberta atribuída ao anfitrião: só esta equipa deve
    // aparecer em `mine=true`, porque a presença implícita não conta.
    const hostMember = await pool.query<{ id: string }>(
      `SELECT id FROM team_members
        WHERE team_id = $1 AND is_host = true AND removed_at IS NULL`,
      [teamSala]
    );
    expect(hostMember.rows[0]?.id).toBeTruthy();

    await taskService.create(scopeOwner, {
      team_id: teamSala,
      title: 'Preparar brindes',
      priority: 'normal',
      assignee_member_id: hostMember.rows[0]!.id,
    });
  });

  afterAll(async () => {
    if (!pool) return;

    await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query(
      `DELETE FROM team_invites
        WHERE team_id IN (SELECT id FROM teams WHERE event_id = ANY($1::uuid[]))`,
      [EVENT_IDS]
    );
    await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM invitations WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.end();
  });

  it('devolve my_role e event_status em cada equipa', async () => {
    const list = await teamService.list(scopeOwner, { page: 1, page_size: 100 });
    const byId = new Map(list.items.map((team) => [team.id, team]));

    expect(byId.size).toBe(10);

    for (const team of list.items) {
      expect(team.myRole).toBe('anfitriao');
      expect(team.eventStatus).toBeDefined();
    }

    expect(byId.get(teamCozinha)?.eventStatus).toBe('agendado');
    expect(byId.get(teamSala)?.eventStatus).toBe('agendado');
    expect(byId.get(teamMusica)?.eventStatus).toBe('agendado');
    expect(byId.get(teamLogistica)?.eventStatus).toBe('agendado');
    expect(byId.get(teamLive)?.eventStatus).toBe('em_curso');
    expect(byId.get(teamDone)?.eventStatus).toBe('concluido');
    expect(byId.get(teamCancelled)?.eventStatus).toBe('cancelado');
    expect(byId.get(teamDraft)?.eventStatus).toBe('rascunho');
    // Sem `ends_at`, o evento termina no fim do dia local de `starts_at`.
    expect(byId.get(teamNoEndDone)?.eventStatus).toBe('concluido');
    expect(byId.get(teamNoEndLive)?.eventStatus).toBe('em_curso');
  });

  it('filtra no servidor por estado do evento, categoria e papel', async () => {
    const live = await teamService.list(scopeOwner, {
      event_status: 'em_curso',
      page: 1,
      page_size: 100,
    });
    expect(sorted(live.items.map((team) => team.id))).toEqual(
      sorted([teamLive, teamNoEndLive])
    );

    const done = await teamService.list(scopeOwner, {
      event_status: 'concluido',
      page: 1,
      page_size: 100,
    });
    expect(sorted(done.items.map((team) => team.id))).toEqual(
      sorted([teamDone, teamNoEndDone])
    );

    const cancelled = await teamService.list(scopeOwner, {
      event_status: 'cancelado',
      page: 1,
      page_size: 100,
    });
    expect(cancelled.items.map((team) => team.id)).toEqual([teamCancelled]);

    const draft = await teamService.list(scopeOwner, {
      event_status: 'rascunho',
      page: 1,
      page_size: 100,
    });
    expect(draft.items.map((team) => team.id)).toEqual([teamDraft]);

    const scheduled = await teamService.list(scopeOwner, {
      event_status: 'agendado',
      page: 1,
      page_size: 100,
    });
    expect(sorted(scheduled.items.map((team) => team.id))).toEqual(
      sorted([teamCozinha, teamSala, teamMusica, teamLogistica])
    );

    const catering = await teamService.list(scopeOwner, {
      category: 'catering',
      page: 1,
      page_size: 100,
    });
    expect(sorted(catering.items.map((team) => team.id))).toEqual(
      sorted([teamCozinha, teamLive])
    );

    const combined = await teamService.list(scopeOwner, {
      category: 'catering',
      event_status: 'agendado',
      role: 'anfitriao',
      q: 'Coz',
      page: 1,
      page_size: 100,
    });
    expect(combined.items.map((team) => team.id)).toEqual([teamCozinha]);
    expect(combined.pagination.total).toBe(1);

    const asMember = await teamService.list(scopeOwner, {
      role: 'membro',
      page: 1,
      page_size: 100,
    });
    expect(asMember.items).toHaveLength(0);
  });

  it('reflecte a despromoção do gestor em my_role e no filtro role', async () => {
    const before = await teamService.list(scopeManager, { page: 1, page_size: 100 });
    expect(sorted(before.items.map((team) => team.id))).toEqual(
      sorted([teamCozinha, teamSala, teamMusica, teamLogistica])
    );
    expect(before.items.every((team) => team.myRole === 'gestor')).toBe(true);

    await teamMemberService.updateRole(scopeOwner, teamCozinha, managerMemberCozinha, {
      role: 'membro',
    });

    const after = await teamService.list(scopeManager, { page: 1, page_size: 100 });
    const byId = new Map(after.items.map((team) => [team.id, team.myRole]));
    expect(byId.get(teamCozinha)).toBe('membro');
    expect(byId.get(teamSala)).toBe('gestor');
    expect(byId.get(teamMusica)).toBe('gestor');
    expect(byId.get(teamLogistica)).toBe('gestor');

    const members = await teamService.list(scopeManager, {
      role: 'membro',
      page: 1,
      page_size: 100,
    });
    expect(members.items.map((team) => team.id)).toEqual([teamCozinha]);

    const managers = await teamService.list(scopeManager, {
      role: 'gestor',
      page: 1,
      page_size: 100,
    });
    expect(sorted(managers.items.map((team) => team.id))).toEqual(
      sorted([teamSala, teamMusica, teamLogistica])
    );
  });

  it('mine ignora a presença implícita do anfitrião e conta tarefas abertas', async () => {
    const ownerMine = await teamService.list(scopeOwner, {
      mine: true,
      page: 1,
      page_size: 100,
    });
    expect(ownerMine.items.map((team) => team.id)).toEqual([teamSala]);

    const managerMine = await teamService.list(scopeManager, {
      mine: true,
      page: 1,
      page_size: 100,
    });
    expect(sorted(managerMine.items.map((team) => team.id))).toEqual(
      sorted([teamCozinha, teamSala, teamMusica, teamLogistica])
    );

    const memberMine = await teamService.list(scopeMember, {
      mine: true,
      page: 1,
      page_size: 100,
    });
    expect(memberMine.items.map((team) => team.id)).toEqual([teamSala]);

    const ownerAll = await teamService.list(scopeOwner, { page: 1, page_size: 100 });
    expect(ownerAll.items).toHaveLength(10);
  });

  it('mantém a paginação coerente com os filtros aplicados', async () => {
    const first = await teamService.list(scopeOwner, {
      category: 'outra',
      page: 1,
      page_size: 2,
    });
    expect(first.pagination).toMatchObject({
      page: 1,
      page_size: 2,
      total: 3,
      total_pages: 2,
    });
    expect(first.items).toHaveLength(2);

    const second = await teamService.list(scopeOwner, {
      category: 'outra',
      page: 2,
      page_size: 2,
    });
    expect(second.pagination.total).toBe(3);
    expect(second.items).toHaveLength(1);

    const combined = await teamService.list(scopeOwner, {
      event_status: 'agendado',
      category: 'outra',
      page: 1,
      page_size: 10,
    });
    expect(combined.pagination.total).toBe(0);
    expect(combined.items).toHaveLength(0);
  });

  it('um anfitrião nunca vê equipas de outro anfitrião', async () => {
    const ownerList = await teamService.list(scopeOwner, { page: 1, page_size: 100 });
    expect(ownerList.items.map((team) => team.id)).not.toContain(teamOther);

    const otherList = await teamService.list(scopeOther, { page: 1, page_size: 100 });
    expect(otherList.items.map((team) => team.id)).toEqual([teamOther]);
    expect(otherList.items[0]?.myRole).toBe('anfitriao');

    await expect(
      teamService.list(scopeOwner, { event_id: EVENT_OTHER, page: 1, page_size: 100 })
    ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });
  });

  it('filtra a lista de equipas por event_id antes da paginação', async () => {
    const allFuture = await teamService.list(scopeOwner, {
      event_id: EVENT_FUTURE,
      page: 1,
      page_size: 100,
    });
    const futureIds = allFuture.items.map((team) => team.id);
    expect(futureIds).toEqual(
      expect.arrayContaining([teamCozinha, teamSala, teamMusica, teamLogistica])
    );
    expect(futureIds).not.toContain(teamLive);
    expect(allFuture.items.every((team) => team.eventId === EVENT_FUTURE)).toBe(true);

    const first = await teamService.list(scopeOwner, {
      event_id: EVENT_FUTURE,
      page: 1,
      page_size: 2,
    });
    const second = await teamService.list(scopeOwner, {
      event_id: EVENT_FUTURE,
      page: 2,
      page_size: 2,
    });

    expect(first.pagination).toMatchObject({
      page: 1,
      page_size: 2,
      total: allFuture.pagination.total,
      total_pages: Math.ceil(allFuture.pagination.total / 2),
    });
    expect(first.items.every((team) => team.eventId === EVENT_FUTURE)).toBe(true);
    expect(second.items.every((team) => team.eventId === EVENT_FUTURE)).toBe(true);
    expect([...first.items, ...second.items].map((team) => team.id).sort()).toEqual(
      [...futureIds].sort()
    );

    // O filtro de categoria é aplicado no servidor, dentro do evento,
    // antes de paginar — nunca se pagina a lista global e depois filtra.
    const catering = await teamService.list(scopeOwner, {
      event_id: EVENT_FUTURE,
      category: 'catering',
      page: 1,
      page_size: 1,
    });
    expect(catering.pagination).toMatchObject({ total: 1, total_pages: 1 });
    expect(catering.items.map((team) => team.id)).toEqual([teamCozinha]);
  });

  it('devolve 404 ao filtrar por event_id de outro evento', async () => {
    for (const scope of [scopeOther, scopeOtherManager]) {
      await expect(
        teamService.list(scope, { event_id: EVENT_FUTURE, page: 1, page_size: 10 })
      ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });
    }

    const own = await teamService.list(scopeOther, {
      event_id: EVENT_OTHER,
      page: 1,
      page_size: 10,
    });
    expect(own.items.map((team) => team.id)).toEqual([teamOther]);
  });

  it('expõe task_count, completed_task_count e members_preview sem emails na lista e no detalhe', async () => {
    const list = await teamService.list(scopeOwner, {
      event_id: EVENT_FUTURE,
      q: 'Sala',
      page: 1,
      page_size: 10,
    });
    const fromList = list.items.find((team) => team.id === teamSala);
    expect(fromList).toBeDefined();
    expect(fromList).toMatchObject({
      taskCount: 1,
      completedTaskCount: 0,
      openTaskCount: 1,
      memberCount: 3,
    });
    expect(fromList!.membersPreview.map((member) => member.id)).toEqual(
      await memberOrder(teamSala)
    );

    const listDto = toTeamDto(fromList!);
    expect(listDto).toMatchObject({
      task_count: 1,
      completed_task_count: 0,
      open_task_count: 1,
      member_count: 3,
    });
    expect(listDto.members_preview).toHaveLength(3);
    expectPreviewSemEmails(listDto.members_preview);

    const detail = await teamService.get(scopeOwner, teamSala);
    expect(detail).toMatchObject({
      taskCount: 1,
      completedTaskCount: 0,
      openTaskCount: 1,
      memberCount: 3,
    });
    expect(detail.membersPreview.map((member) => member.id)).toEqual(
      await memberOrder(teamSala)
    );

    const detailDto = toTeamDto(detail);
    expect(detailDto.members_preview).toEqual(listDto.members_preview);
    expectPreviewSemEmails(detailDto.members_preview);
  });

  it('exclui tarefas arquivadas das contagens e limita members_preview a quatro membros por ordem de entrada', async () => {
    const team = await teamService.create(scopeOwner, {
      event_id: EVENT_FUTURE,
      name: 'Estatísticas da lista',
      category: 'rececao',
      description: null,
    });

    try {
      const added = await teamMemberService.add(scopeOwner, team.id, {
        emails: [
          'preview-um@exemplo.pt',
          'preview-dois@exemplo.pt',
          'preview-tres@exemplo.pt',
          'preview-quatro@exemplo.pt',
        ],
      });
      // Sem conta activa ficam `convite_pendente`, mas continuam a ser
      // membros da equipa e a aparecer na pré-visualização.
      expect(added.pending).toHaveLength(4);

      const ids = await memberOrder(team.id);
      expect(ids).toHaveLength(6); // anfitrião + gestor + 4 convidados
      // Datas de entrada explícitas, numa ordem diferente da inserção,
      // para provar que a pré-visualização segue `created_at, id`.
      const expectedOrder = [...ids].reverse();
      for (const [index, id] of expectedOrder.entries()) {
        await pool.query('UPDATE team_members SET created_at = $2 WHERE id = $1', [
          id,
          new Date(Date.UTC(2030, 0, 1, 0, 0, index)),
        ]);
      }

      const open = await taskService.create(scopeOwner, {
        team_id: team.id,
        title: 'Tarefa aberta',
        priority: 'normal',
        status: 'por_fazer',
      });
      const completed = await taskService.create(scopeOwner, {
        team_id: team.id,
        title: 'Tarefa concluída',
        priority: 'normal',
        status: 'concluida',
      });
      const archivedOpen = await taskService.create(scopeOwner, {
        team_id: team.id,
        title: 'Tarefa aberta arquivada',
        priority: 'normal',
        status: 'por_fazer',
      });
      const archivedCompleted = await taskService.create(scopeOwner, {
        team_id: team.id,
        title: 'Tarefa concluída arquivada',
        priority: 'normal',
        status: 'concluida',
      });
      await pool.query('UPDATE host_tasks SET archived_at = now() WHERE id = ANY($1::uuid[])', [
        [archivedOpen.id, archivedCompleted.id],
      ]);

      const detail = await teamService.get(scopeOwner, team.id);
      expect(detail).toMatchObject({
        taskCount: 2,
        completedTaskCount: 1,
        openTaskCount: 1,
        memberCount: 6,
      });
      expect(detail.membersPreview.map((member) => member.id)).toEqual(
        expectedOrder.slice(0, 4)
      );

      const dto = toTeamDto(detail);
      expect(dto).toMatchObject({
        task_count: 2,
        completed_task_count: 1,
        open_task_count: 1,
        member_count: 6,
      });
      expect(dto.members_preview.map((member) => member.id)).toEqual(
        expectedOrder.slice(0, 4)
      );
      expect(dto.members_preview).toHaveLength(4);
      expectPreviewSemEmails(dto.members_preview);
      // Garante que as quatro tarefas criadas existem: só as duas não
      // arquivadas podem entrar nas contagens acima.
      expect(new Set([open.id, completed.id, archivedOpen.id, archivedCompleted.id]).size).toBe(4);
      const archivedIds = [archivedOpen.id, archivedCompleted.id];
      const { rows } = await pool.query<{ id: string }>(
        'SELECT id FROM host_tasks WHERE archived_at IS NOT NULL AND id = ANY($1::uuid[])',
        [archivedIds]
      );
      expect(rows.map((row) => row.id).sort()).toEqual([...archivedIds].sort());
    } finally {
      await teamService.remove(scopeOwner, team.id, { confirm: true, archive: true });
    }
  });

  it('devolve contagens e members_preview atualizados ao criar e editar uma equipa', async () => {
    const created = await teamService.create(scopeOwner, {
      event_id: EVENT_FUTURE,
      name: 'Respostas de criação',
      category: 'rececao',
      description: null,
    });

    try {
      expect(created).toMatchObject({
        taskCount: 0,
        completedTaskCount: 0,
        openTaskCount: 0,
      });
      expect(created.membersPreview.map((member) => member.id)).toEqual(
        await memberOrder(created.id)
      );
      const createdDto = toTeamDto(created);
      expect(createdDto).toMatchObject({
        task_count: 0,
        completed_task_count: 0,
        open_task_count: 0,
      });
      expect(createdDto.members_preview.length).toBeGreaterThanOrEqual(2);
      expectPreviewSemEmails(createdDto.members_preview);

      await taskService.create(scopeOwner, {
        team_id: created.id,
        title: 'Aberta da edição',
        priority: 'normal',
        status: 'por_fazer',
      });
      await taskService.create(scopeOwner, {
        team_id: created.id,
        title: 'Concluída da edição',
        priority: 'normal',
        status: 'concluida',
      });

      const updated = await teamService.update(scopeOwner, created.id, {
        name: 'Respostas de edição',
        description: 'Contagens actualizadas',
      });
      expect(updated.name).toBe('Respostas de edição');
      expect(updated).toMatchObject({
        taskCount: 2,
        completedTaskCount: 1,
        openTaskCount: 1,
      });
      expect(updated.membersPreview.map((member) => member.id)).toEqual(
        await memberOrder(created.id)
      );
      const updatedDto = toTeamDto(updated);
      expect(updatedDto).toMatchObject({
        task_count: 2,
        completed_task_count: 1,
        open_task_count: 1,
      });
      expectPreviewSemEmails(updatedDto.members_preview);
    } finally {
      await teamService.remove(scopeOwner, created.id, { confirm: true, archive: true });
    }
  });

  it('um membro só vê as equipas e os membros das suas equipas', async () => {
    const list = await teamService.list(scopeMember, { page: 1, page_size: 100 });
    expect(list.items.map((team) => team.id)).toEqual([teamSala]);

    const own = await teamService.get(scopeMember, teamSala);
    expect(own.id).toBe(teamSala);
    const { rows } = await pool.query<{ email: string }>(
      `SELECT email FROM team_members
        WHERE team_id = $1 AND removed_at IS NULL`,
      [teamSala]
    );
    expect(rows.map((row) => row.email)).toContain(EMAIL_MEMBER);
    expectPreviewSemEmails(toTeamDto(own).members_preview);

    await expect(teamService.get(scopeMember, teamCozinha)).rejects.toMatchObject({
      statusCode: 404,
      code: 'team_not_found',
    });
  });

  it('anfitrião e gestor de outro evento não veem equipas deste evento', async () => {
    for (const scope of [scopeOther, scopeOtherManager]) {
      const list = await teamService.list(scope, { page: 1, page_size: 100 });
      expect(list.items.map((team) => team.id)).toEqual([teamOther]);
      expect(list.items.map((team) => team.id)).not.toContain(teamCozinha);
      expect(list.items.map((team) => team.id)).not.toContain(teamSala);

      await expect(teamService.get(scope, teamCozinha)).rejects.toMatchObject({
        statusCode: 404,
        code: 'team_not_found',
      });
      await expect(
        teamService.list(scope, { event_id: EVENT_FUTURE, page: 1, page_size: 10 })
      ).rejects.toMatchObject({ statusCode: 404, code: 'event_not_found' });
    }
  });
});

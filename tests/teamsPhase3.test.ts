import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Testes de integração da Fase 3: convites de equipa, anti-spam,
 * notificações e outbox.
 *
 * Só correm quando `TEAMS_API_TEST_URL` aponta para uma CÓPIA migrada
 * da base de dados. Nunca tocam na base de desenvolvimento: o URL é
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

const HOST_OWNER = 'eeeeeeee-1111-4000-8000-000000000001';
const HOST_MANAGER = 'eeeeeeee-1111-4000-8000-000000000002';
const HOST_MEMBER = 'eeeeeeee-1111-4000-8000-000000000003';
const HOST_INVITEE = 'eeeeeeee-1111-4000-8000-000000000004';
const HOST_INVITEE_TWO = 'eeeeeeee-1111-4000-8000-000000000005';
const HOST_ACTIVE_TWO = 'eeeeeeee-1111-4000-8000-000000000006';
const HOST_UNVERIFIED = 'eeeeeeee-1111-4000-8000-000000000007';
const HOST_NEW_ACTIVE = 'eeeeeeee-1111-4000-8000-000000000008';

const EVENT = 'f0000000-1111-4000-8000-000000000001';
const MANAGER_ID = 'ab000000-1111-4000-8000-000000000001';

const EMAIL_OWNER = 'phase3-owner@exemplo.pt';
const EMAIL_MANAGER = 'phase3-manager@exemplo.pt';
const EMAIL_MEMBER = 'phase3-member@exemplo.pt';
const EMAIL_ACTIVE_TWO = 'phase3-active-two@exemplo.pt';
const EMAIL_PENDING = 'phase3-pending@exemplo.pt';
const EMAIL_PENDING_TWO = 'phase3-pending-two@exemplo.pt';
const EMAIL_PENDING_THREE = 'phase3-pending-three@exemplo.pt';
const EMAIL_PENDING_FOUR = 'phase3-pending-four@exemplo.pt';
const EMAIL_RATE = 'phase3-rate@exemplo.pt';
const EMAIL_UNVERIFIED = 'phase3-unverified@exemplo.pt';
const EMAIL_NEW_ACTIVE = 'phase3-new-active@exemplo.pt';

const HOST_IDS = [
  HOST_OWNER,
  HOST_MANAGER,
  HOST_MEMBER,
  HOST_INVITEE,
  HOST_INVITEE_TWO,
  HOST_ACTIVE_TWO,
  HOST_UNVERIFIED,
  HOST_NEW_ACTIVE,
];
const EVENT_IDS = [EVENT];

interface Scope {
  hostId: string;
  managerEmail: string | null;
}

const scopeOwner: Scope = { hostId: HOST_OWNER, managerEmail: EMAIL_OWNER };
const scopeMember: Scope = { hostId: HOST_MEMBER, managerEmail: EMAIL_MEMBER };

type TeamService = typeof import('../src/services/team.service').teamService;
type TeamMemberService = typeof import('../src/services/teamMember.service').teamMemberService;
type TaskService = typeof import('../src/services/task.service').taskService;
type TeamInviteService = typeof import('../src/services/teamInvite.service').teamInviteService;

describe.skipIf(!connectionString)('convites e notificações de equipa (integração)', () => {
  let pool: import('pg').Pool;
  let teamService: TeamService;
  let teamMemberService: TeamMemberService;
  let taskService: TaskService;
  let teamInviteService: TeamInviteService;
  let decryptToken: typeof import('../src/utils/crypto.util').decryptToken;

  let teamId: string;
  let memberMemberId: string;
  let managerMemberId: string;

  async function memberIdFor(email: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM team_members
        WHERE team_id = $1 AND email = $2::citext AND removed_at IS NULL`,
      [teamId, email]
    );

    expect(rows).toHaveLength(1);
    return rows[0]!.id;
  }

  /** Convite activo e token em claro reconstruído a partir da outbox. */
  async function activeInviteFor(
    memberId: string
  ): Promise<{ inviteId: string; token: string; sendCount: number }> {
    const { rows } = await pool.query<{
      id: string;
      send_count: number;
      token_encrypted: string;
    }>(
      `SELECT ti.id, ti.send_count, d.token_encrypted
         FROM team_invites ti
         JOIN email_deliveries d
           ON d.message_type = 'team_invite'
          AND d.payload->>'inviteId' = ti.id::text
        WHERE ti.member_id = $1
          AND ti.accepted_at IS NULL
          AND ti.revoked_at IS NULL
        ORDER BY d.created_at DESC
        LIMIT 1`,
      [memberId]
    );

    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    return {
      inviteId: row.id,
      token: decryptToken(row.token_encrypted),
      sendCount: row.send_count,
    };
  }

  async function addPendingMember(email: string): Promise<string> {
    const result = await teamMemberService.add(scopeOwner, teamId, { emails: [email] });
    const entry = result.pending.find((row) => row.email === email);

    expect(entry?.memberId).toBeTruthy();
    return entry!.memberId!;
  }

  beforeAll(async () => {
    ({ pool } = await import('../src/database/pool'));
    ({ teamService } = await import('../src/services/team.service'));
    ({ teamMemberService } = await import('../src/services/teamMember.service'));
    ({ taskService } = await import('../src/services/task.service'));
    ({ teamInviteService } = await import('../src/services/teamInvite.service'));
    ({ decryptToken } = await import('../src/utils/crypto.util'));

    await pool.query('DELETE FROM email_deliveries WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_notifications WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);

    await pool.query(
      `INSERT INTO hosts (id, email, password_hash, email_verified_at, status) VALUES
         ($1, $2, 'x', now(), 'active'),
         ($3, $4, 'x', now(), 'active'),
         ($5, $6, 'x', now(), 'active'),
         ($7, $8, 'x', now(), 'active')`,
      [
        HOST_OWNER,
        EMAIL_OWNER,
        HOST_MANAGER,
        EMAIL_MANAGER,
        HOST_MEMBER,
        EMAIL_MEMBER,
        HOST_ACTIVE_TWO,
        EMAIL_ACTIVE_TWO,
      ]
    );

    await pool.query(
      `INSERT INTO host_profiles (host_id, display_name) VALUES
         ($1, 'Anfitriã Fase 3'), ($2, 'Gestora Fase 3'),
         ($3, 'Membro Fase 3'), ($4, 'Segunda Membro')`,
      [HOST_OWNER, HOST_MANAGER, HOST_MEMBER, HOST_ACTIVE_TWO]
    );

    await pool.query(
      `INSERT INTO events (
         id, manage_token_hash, title, host_name, host_email, starts_at, status,
         host_id, location_type, location_name
       ) VALUES ($1, 'phase3-hash', 'Evento Fase 3', 'Anfitriã Fase 3', $2,
                 now() + interval '30 days', 'scheduled', $3, 'venue', 'Quinta Fase 3')`,
      [EVENT, EMAIL_OWNER, HOST_OWNER]
    );

    await pool.query(
      `INSERT INTO event_managers (id, event_id, email) VALUES ($1, $2, $3)`,
      [MANAGER_ID, EVENT, EMAIL_MANAGER]
    );

    teamId = (
      await teamService.create(scopeOwner, {
        event_id: EVENT,
        name: 'Cozinha Fase 3',
        category: 'catering',
        description: null,
      })
    ).id;

    await teamMemberService.add(scopeOwner, teamId, {
      emails: [EMAIL_MEMBER, EMAIL_ACTIVE_TWO],
    });

    memberMemberId = await memberIdFor(EMAIL_MEMBER);
    managerMemberId = await memberIdFor(EMAIL_MANAGER);
  });

  afterAll(async () => {
    if (!pool) return;

    await pool.query('DELETE FROM email_deliveries WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_notifications WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_tasks WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM teams WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM event_managers WHERE event_id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM events WHERE id = ANY($1::uuid[])', [EVENT_IDS]);
    await pool.query('DELETE FROM host_profiles WHERE host_id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.query('DELETE FROM hosts WHERE id = ANY($1::uuid[])', [HOST_IDS]);
    await pool.end();
  });

  it('adiciona um membro sem conta, cria o convite e enfileira o email', async () => {
    const pendingId = await addPendingMember(EMAIL_PENDING);
    const active = await activeInviteFor(pendingId);

    expect(active.sendCount).toBe(1);
    expect(active.token.length).toBeGreaterThan(20);

    const { rows } = await pool.query<{
      recipient_email: string;
      status: string;
      payload: Record<string, unknown>;
      token_encrypted: string;
    }>(
      `SELECT recipient_email, status, payload, token_encrypted
         FROM email_deliveries
        WHERE message_type = 'team_invite'
          AND payload->>'inviteId' = $1`,
      [active.inviteId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_email: EMAIL_PENDING,
      status: 'pending',
    });
    expect(rows[0]!.payload.teamName).toBe('Cozinha Fase 3');
    expect(rows[0]!.token_encrypted).not.toContain(active.token);

    const preview = await teamInviteService.preview(active.token);
    expect(preview).toEqual({
      team_name: 'Cozinha Fase 3',
      invited_by: 'Anfitriã Fase 3',
    });
    expect(Object.keys(preview).sort()).toEqual(['invited_by', 'team_name']);
    expect(JSON.stringify(preview)).not.toContain('Evento Fase 3');
    expect(JSON.stringify(preview)).not.toContain('pending');
  });

  it('exige email verificado e coincidente para aceitar o convite', async () => {
    const pendingId = await addPendingMember(EMAIL_PENDING_TWO);
    const active = await activeInviteFor(pendingId);

    await pool.query(
      `INSERT INTO hosts (id, email, password_hash, email_verified_at, status)
       VALUES ($1, $2, 'x', now(), 'active')`,
      [HOST_INVITEE_TWO, EMAIL_PENDING_TWO]
    );
    await pool.query(`INSERT INTO host_profiles (host_id, display_name) VALUES ($1, 'Convidada Dois')`, [
      HOST_INVITEE_TWO,
    ]);

    await expect(
      teamInviteService.accept(active.token, {
        hostId: HOST_INVITEE_TWO,
        email: EMAIL_PENDING_TWO,
        displayName: 'Convidada Dois',
        emailVerified: false,
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'email_not_verified' });

    await expect(
      teamInviteService.accept(active.token, {
        hostId: HOST_OWNER,
        email: EMAIL_OWNER,
        displayName: 'Anfitriã',
        emailVerified: true,
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'invite_email_mismatch' });

    const accepted = await teamInviteService.accept(active.token, {
      hostId: HOST_INVITEE_TWO,
      email: EMAIL_PENDING_TWO,
      displayName: 'Convidada Dois',
      emailVerified: true,
    });

    expect(accepted).toMatchObject({
      member_id: pendingId,
      team_id: teamId,
      team_name: 'Cozinha Fase 3',
      role: 'membro',
    });

    const { rows } = await pool.query<{
      status: string;
      host_id: string | null;
      accepted_at: Date | null;
    }>(
      `SELECT m.status, m.host_id, ti.accepted_at
         FROM team_members m
         JOIN team_invites ti ON ti.member_id = m.id
        WHERE m.id = $1`,
      [pendingId]
    );

    expect(rows[0]).toMatchObject({
      status: 'ativo',
      host_id: HOST_INVITEE_TWO,
    });
    expect(rows[0]!.accepted_at).not.toBeNull();

    const delivery = await pool.query<{ status: string }>(
      `SELECT status FROM email_deliveries
        WHERE message_type = 'team_invite' AND payload->>'inviteId' = $1`,
      [active.inviteId]
    );
    expect(delivery.rows[0]?.status).toBe('cancelled');

    await expect(
      teamInviteService.accept(active.token, {
        hostId: HOST_INVITEE_TWO,
        email: EMAIL_PENDING_TWO,
        displayName: 'Convidada Dois',
        emailVerified: true,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'invite_already_accepted' });

    await expect(teamInviteService.preview(active.token)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invite_already_accepted',
    });
  });

  it('aceita o convite uma única vez em pedidos concorrentes', async () => {
    const pendingId = await addPendingMember(EMAIL_PENDING_THREE);
    const active = await activeInviteFor(pendingId);

    await pool.query(
      `INSERT INTO hosts (id, email, password_hash, email_verified_at, status)
       VALUES ($1, $2, 'x', now(), 'active')`,
      [HOST_INVITEE, EMAIL_PENDING_THREE]
    );
    await pool.query(`INSERT INTO host_profiles (host_id, display_name) VALUES ($1, 'Convidada Três')`, [
      HOST_INVITEE,
    ]);

    const account = {
      hostId: HOST_INVITEE,
      email: EMAIL_PENDING_THREE,
      displayName: 'Convidada Três',
      emailVerified: true,
    };

    const results = await Promise.allSettled([
      teamInviteService.accept(active.token, account),
      teamInviteService.accept(active.token, account),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      statusCode: 409,
    });

    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM team_invites
        WHERE member_id = $1 AND accepted_at IS NOT NULL`,
      [pendingId]
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('aplica cooldown e limite de reenvios, rotacionando o token', async () => {
    const pendingId = await addPendingMember(EMAIL_PENDING_FOUR);
    const first = await activeInviteFor(pendingId);

    await expect(teamInviteService.resend(scopeOwner, teamId, pendingId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'invite_cooldown',
    });

    await pool.query(
      `UPDATE team_invites SET last_sent_at = now() - interval '11 minutes' WHERE id = $1`,
      [first.inviteId]
    );

    const resent = await teamInviteService.resend(scopeOwner, teamId, pendingId);
    expect(resent.send_count).toBe(2);

    await expect(teamInviteService.preview(first.token)).rejects.toMatchObject({
      statusCode: 404,
      code: 'invite_not_found',
    });

    const second = await activeInviteFor(pendingId);
    expect(second.token).not.toBe(first.token);
    await expect(teamInviteService.preview(second.token)).resolves.toMatchObject({
      team_name: 'Cozinha Fase 3',
    });

    await pool.query(
      `UPDATE team_invites
          SET send_count = 5, last_sent_at = now() - interval '11 minutes'
        WHERE id = $1`,
      [first.inviteId]
    );

    await expect(teamInviteService.resend(scopeOwner, teamId, pendingId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invite_send_limit',
    });
  });

  it('limita a 3 emails por destinatário em 24 horas', async () => {
    const pendingId = await addPendingMember(EMAIL_RATE);
    const active = await activeInviteFor(pendingId);

    await pool.query(`UPDATE team_invites SET last_sent_at = now() - interval '11 minutes' WHERE id = $1`, [
      active.inviteId,
    ]);

    // O convite inicial já conta como 1. Mais dois esgotam os 3.
    for (let index = 0; index < 2; index += 1) {
      await pool.query(
        `INSERT INTO email_deliveries (
           event_id, message_type, recipient_email, scheduled_for,
           idempotency_key, payload
         ) VALUES ($1, 'team_invite', $2, now(), $3, '{}'::jsonb)`,
        [EVENT, EMAIL_RATE, `phase3-rate-email-${index}-${pendingId}`]
      );
    }

    await expect(teamInviteService.resend(scopeOwner, teamId, pendingId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'invite_email_rate_limited',
    });
  });

  it('limita convites por anfitrião por hora e por dia', async () => {
    const pendingId = await addPendingMember('phase3-host-rate@exemplo.pt');
    const active = await activeInviteFor(pendingId);

    await pool.query(
      `UPDATE team_invites SET last_sent_at = now() - interval '11 minutes' WHERE id = $1`,
      [active.inviteId]
    );

    const scopeManager = { hostId: HOST_MANAGER, managerEmail: EMAIL_MANAGER };

    // 30 convites na última hora esgotam o limite horário.
    for (let index = 0; index < 30; index += 1) {
      await pool.query(
        `INSERT INTO team_invites (
           member_id, team_id, email, created_by_host_id, token_hash, expires_at, revoked_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', now())`,
        [
          pendingId,
          teamId,
          `phase3-host-rate-${index}@exemplo.pt`,
          HOST_MANAGER,
          `phase3-host-rate-hash-${index}`,
        ]
      );
    }

    await expect(teamInviteService.resend(scopeManager, teamId, pendingId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'invite_host_rate_limited',
    });

    // Remove os da última hora e deixa 100 nas últimas 24 horas.
    await pool.query(
      `DELETE FROM team_invites WHERE created_by_host_id = $1 AND token_hash LIKE 'phase3-host-rate-hash-%'`,
      [HOST_MANAGER]
    );

    for (let index = 0; index < 100; index += 1) {
      await pool.query(
        `INSERT INTO team_invites (
           member_id, team_id, email, created_by_host_id, token_hash, expires_at, revoked_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, now() + interval '7 days', now(), now() - interval '2 hours')`,
        [
          pendingId,
          teamId,
          `phase3-host-day-${index}@exemplo.pt`,
          HOST_MANAGER,
          `phase3-host-day-hash-${index}`,
        ]
      );
    }

    await expect(teamInviteService.resend(scopeManager, teamId, pendingId)).rejects.toMatchObject({
      statusCode: 429,
      code: 'invite_host_rate_limited',
    });

    await pool.query(
      `DELETE FROM team_invites WHERE created_by_host_id = $1 AND token_hash LIKE 'phase3-host-day-hash-%'`,
      [HOST_MANAGER]
    );
  });

  it('mantém pendente uma conta registada com email por verificar', async () => {
    await pool.query(
      `INSERT INTO hosts (id, email, password_hash, email_verified_at, status)
       VALUES ($1, $2, 'x', NULL, 'active')`,
      [HOST_UNVERIFIED, EMAIL_UNVERIFIED]
    );
    await pool.query(
      `INSERT INTO host_profiles (host_id, display_name) VALUES ($1, 'Conta Por Verificar')`,
      [HOST_UNVERIFIED]
    );

    const result = await teamMemberService.add(scopeOwner, teamId, {
      emails: [EMAIL_UNVERIFIED],
    });

    expect(result.added).toHaveLength(0);
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]).toMatchObject({
      email: EMAIL_UNVERIFIED,
      status: 'convite_pendente',
    });

    const memberId = result.pending[0]!.memberId!;
    const { rows } = await pool.query<{ status: string; host_id: string | null }>(
      `SELECT status, host_id FROM team_members WHERE id = $1`,
      [memberId]
    );
    expect(rows[0]).toMatchObject({ status: 'convite_pendente', host_id: null });

    const invite = await activeInviteFor(memberId);
    expect(invite.sendCount).toBe(1);
  });

  it('notifica in-app e por email quando adiciona uma conta verificada', async () => {
    await pool.query(
      `INSERT INTO hosts (id, email, password_hash, email_verified_at, status)
       VALUES ($1, $2, 'x', now(), 'active')`,
      [HOST_NEW_ACTIVE, EMAIL_NEW_ACTIVE]
    );
    await pool.query(
      `INSERT INTO host_profiles (host_id, display_name) VALUES ($1, 'Conta Verificada')`,
      [HOST_NEW_ACTIVE]
    );

    const before = (await pool.query<{ now: Date }>('SELECT now() AS now')).rows[0]!.now;
    const result = await teamMemberService.add(scopeOwner, teamId, {
      emails: [EMAIL_NEW_ACTIVE],
    });

    expect(result.added).toHaveLength(1);
    expect(result.pending).toHaveLength(0);

    const memberId = result.added[0]!.memberId!;
    const notifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_notifications
        WHERE host_id = $1 AND kind = 'team_added' AND created_at >= $2
          AND metadata->>'team_id' = $3`,
      [HOST_NEW_ACTIVE, before, teamId]
    );
    expect(notifications.rows[0]?.count).toBe('1');

    const emails = await pool.query<{ recipient_email: string; status: string }>(
      `SELECT recipient_email, status FROM email_deliveries
        WHERE message_type = 'team_added'
          AND payload->>'teamId' = $1
          AND created_at >= $2`,
      [teamId, before]
    );
    expect(emails.rows).toEqual([{ recipient_email: EMAIL_NEW_ACTIVE, status: 'pending' }]);

    const inviteEmails = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_deliveries
        WHERE message_type = 'team_invite' AND recipient_email = $1`,
      [EMAIL_NEW_ACTIVE]
    );
    expect(inviteEmails.rows[0]?.count).toBe('0');

    const active = await pool.query<{ status: string }>(
      `SELECT status FROM team_members WHERE id = $1`,
      [memberId]
    );
    expect(active.rows[0]?.status).toBe('ativo');
  });

  it('revoga e bloqueia o remetente em "Não conheço este convite"', async () => {
    const email = 'phase3-unknown@exemplo.pt';
    const pendingId = await addPendingMember(email);
    const active = await activeInviteFor(pendingId);

    // Um token inexistente responde da mesma forma e não revela nada.
    await expect(teamInviteService.reportUnknown('token-inexistente-1234567890')).resolves.toBeUndefined();

    await teamInviteService.reportUnknown(active.token);

    const invite = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM team_invites WHERE id = $1`,
      [active.inviteId]
    );
    expect(invite.rows[0]?.revoked_at).not.toBeNull();

    const delivery = await pool.query<{ status: string }>(
      `SELECT status FROM email_deliveries
        WHERE message_type = 'team_invite' AND payload->>'inviteId' = $1`,
      [active.inviteId]
    );
    expect(delivery.rows[0]?.status).toBe('cancelled');

    const block = await pool.query<{ reason: string }>(
      `SELECT reason FROM team_invite_blocks
        WHERE host_id = $1 AND email = $2::citext`,
      [HOST_OWNER, email]
    );
    expect(block.rows).toEqual([{ reason: 'unknown_invite' }]);

    // O anfitrião vê apenas uma mensagem genérica, sem saber da denúncia.
    await expect(teamInviteService.resend(scopeOwner, teamId, pendingId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invite_not_possible',
      message: 'Não foi possível convidar este email.',
    });

    await expect(teamInviteService.preview(active.token)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invite_revoked',
    });
  });

  it('recusa tokens expirados e revogados', async () => {
    const expiredId = await addPendingMember('phase3-expired@exemplo.pt');
    const expired = await activeInviteFor(expiredId);

    await pool.query(
      `UPDATE team_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [expired.inviteId]
    );

    await expect(teamInviteService.preview(expired.token)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invite_expired',
    });

    const revokedId = await addPendingMember('phase3-revoked@exemplo.pt');
    const revoked = await activeInviteFor(revokedId);

    await pool.query(`UPDATE team_invites SET revoked_at = now() WHERE id = $1`, [
      revoked.inviteId,
    ]);

    await expect(teamInviteService.preview(revoked.token)).rejects.toMatchObject({
      statusCode: 409,
      code: 'invite_revoked',
    });
  });

  it('notifica a atribuição e não envia email ao próprio autor', async () => {
    const task = await taskService.create(scopeOwner, {
      title: 'Tarefa atribuída',
      team_id: teamId,
      assignee_member_id: memberMemberId,
      priority: 'normal',
      status: 'por_fazer',
    });

    const notifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_notifications
        WHERE host_id = $1 AND kind = 'task_assigned'
          AND metadata->>'task_id' = $2`,
      [HOST_MEMBER, task.id]
    );
    expect(notifications.rows[0]?.count).toBe('1');

    const emails = await pool.query<{ recipient_email: string; status: string }>(
      `SELECT recipient_email, status FROM email_deliveries
        WHERE message_type = 'task_assigned' AND payload->>'taskId' = $1`,
      [task.id]
    );
    expect(emails.rows).toEqual([{ recipient_email: EMAIL_MEMBER, status: 'pending' }]);

    const selfTask = await taskService.create(scopeOwner, {
      title: 'Tarefa da anfitriã',
      team_id: teamId,
      assignee_member_id: (await memberIdFor(EMAIL_OWNER)),
      priority: 'normal',
      status: 'por_fazer',
    });

    const selfEmails = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_deliveries
        WHERE message_type = 'task_assigned' AND payload->>'taskId' = $1`,
      [selfTask.id]
    );
    expect(selfEmails.rows[0]?.count).toBe('0');
  });

  it('conclui uma vez e notifica apenas o criador e o anfitrião sem duplicar', async () => {
    const task = await taskService.create(scopeOwner, {
      title: 'Tarefa concorrente',
      team_id: teamId,
      assignee_member_id: memberMemberId,
      priority: 'alta',
      status: 'por_fazer',
    });

    const [first, second] = await Promise.all([
      taskService.setStatus(scopeMember, task.id, { status: 'concluida' }),
      taskService.setStatus(scopeMember, task.id, { status: 'concluida' }),
    ]);

    expect(first.completedAt?.toISOString()).toBe(second.completedAt?.toISOString());

    const emails = await pool.query<{ recipient_email: string }>(
      `SELECT recipient_email FROM email_deliveries
        WHERE message_type = 'task_completed' AND payload->>'taskId' = $1
        ORDER BY recipient_email`,
      [task.id]
    );
    // A tarefa foi criada pelo anfitrião, que também é o dono do
    // evento: criador e anfitrião são a mesma conta, pelo que só há um
    // email. Os gestores deixaram de ser notificados em bloco.
    expect(emails.rows.map((row) => row.recipient_email)).toEqual([EMAIL_OWNER]);

    const notifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_notifications
        WHERE kind = 'task_completed' AND metadata->>'task_id' = $1`,
      [task.id]
    );
    expect(notifications.rows[0]?.count).toBe('1');
  });

  it('notifica o criador e o anfitrião quando são contas diferentes', async () => {
    const task = await taskService.create(
      { hostId: HOST_MANAGER, managerEmail: EMAIL_MANAGER },
      {
        title: 'Tarefa criada por gestora',
        team_id: teamId,
        assignee_member_id: memberMemberId,
        priority: 'normal',
        status: 'por_fazer',
      }
    );

    await taskService.setStatus(scopeMember, task.id, { status: 'concluida' });

    const emails = await pool.query<{ recipient_email: string }>(
      `SELECT recipient_email FROM email_deliveries
        WHERE message_type = 'task_completed' AND payload->>'taskId' = $1
        ORDER BY recipient_email`,
      [task.id]
    );
    expect(emails.rows.map((row) => row.recipient_email)).toEqual(
      [EMAIL_MANAGER, EMAIL_OWNER].sort()
    );

    const notifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_notifications
        WHERE kind = 'task_completed' AND metadata->>'task_id' = $1`,
      [task.id]
    );
    expect(notifications.rows[0]?.count).toBe('2');
  });

  it('notifica o novo responsável e o anterior na reatribuição', async () => {
    const task = await taskService.create(scopeOwner, {
      title: 'Tarefa reatribuída',
      team_id: teamId,
      assignee_member_id: memberMemberId,
      priority: 'normal',
      status: 'por_fazer',
    });

    const updated = await taskService.reassign(scopeOwner, task.id, {
      assignee_member_id: managerMemberId,
    });
    expect(updated.assigneeMemberId).toBe(managerMemberId);

    const emails = await pool.query<{ recipient_email: string; variant: string }>(
      `SELECT recipient_email, payload->>'variant' AS variant FROM email_deliveries
        WHERE message_type = 'task_reassigned' AND payload->>'taskId' = $1
        ORDER BY recipient_email`,
      [task.id]
    );
    expect(emails.rows).toEqual(
      [
        { recipient_email: EMAIL_MANAGER, variant: 'novo' },
        { recipient_email: EMAIL_MEMBER, variant: 'anterior' },
      ].sort((a, b) => a.recipient_email.localeCompare(b.recipient_email))
    );

    const notifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_notifications
        WHERE kind = 'task_reassigned' AND metadata->>'task_id' = $1`,
      [task.id]
    );
    expect(notifications.rows[0]?.count).toBe('2');
  });

  it('remove um membro, reatribui tarefas e revoga convites', async () => {
    const pendingId = await addPendingMember('phase3-removed-pending@exemplo.pt');
    const pendingInvite = await activeInviteFor(pendingId);

    const task = await taskService.create(scopeOwner, {
      title: 'Tarefa da remoção',
      team_id: teamId,
      assignee_member_id: memberMemberId,
      priority: 'normal',
      status: 'por_fazer',
    });

    const result = await teamMemberService.remove(scopeOwner, teamId, memberMemberId, {
      reassign_to_member_id: managerMemberId,
    });
    expect(result).toMatchObject({ removed: true });
    expect(result.reassignedTasks).toBeGreaterThanOrEqual(1);

    const member = await pool.query<{ removed_at: Date | null }>(
      `SELECT removed_at FROM team_members WHERE id = $1`,
      [memberMemberId]
    );
    expect(member.rows[0]?.removed_at).not.toBeNull();

    const moved = await pool.query<{ assignee_member_id: string }>(
      `SELECT assignee_member_id FROM host_tasks WHERE id = $1`,
      [task.id]
    );
    expect(moved.rows[0]?.assignee_member_id).toBe(managerMemberId);

    // Quem é removido não recebe mensagem de remoção.
    const removalEmail = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM email_deliveries
        WHERE recipient_email = $1
          AND message_type = 'member_removed'
          AND created_at >= now() - interval '5 minutes'`,
      [EMAIL_MEMBER]
    );
    expect(removalEmail.rows[0]?.count).toBe('0');

    const reassignedEmails = await pool.query<{ recipient_email: string }>(
      `SELECT recipient_email FROM email_deliveries
        WHERE message_type = 'task_reassigned' AND payload->>'taskId' = $1`,
      [task.id]
    );
    expect(reassignedEmails.rows.map((row) => row.recipient_email)).toEqual([EMAIL_MANAGER]);

    await teamMemberService.remove(scopeOwner, teamId, pendingId, {});

    const revoked = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM team_invites WHERE id = $1`,
      [pendingInvite.inviteId]
    );
    expect(revoked.rows[0]?.revoked_at).not.toBeNull();

    // O email de convite pendente é cancelado na remoção.
    const cancelled = await pool.query<{ status: string }>(
      `SELECT status FROM email_deliveries
        WHERE message_type = 'team_invite' AND payload->>'inviteId' = $1`,
      [pendingInvite.inviteId]
    );
    expect(cancelled.rows[0]?.status).toBe('cancelled');
  });

  it('notifica a alteração de papel in-app e por email', async () => {
    const activeTwoId = await memberIdFor(EMAIL_ACTIVE_TWO);
    const before = (
      await pool.query<{ now: Date }>('SELECT now() AS now')
    ).rows[0]!.now;

    const result = await teamMemberService.updateRole(scopeOwner, teamId, activeTwoId, {
      role: 'gestor',
    });
    expect(result.member.role).toBe('gestor');

    const notifications = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM host_notifications
        WHERE host_id = $1 AND kind = 'role_changed' AND created_at >= $2`,
      [HOST_ACTIVE_TWO, before]
    );
    expect(notifications.rows[0]?.count).toBe('1');

    const emails = await pool.query<{ recipient_email: string; status: string }>(
      `SELECT recipient_email, status FROM email_deliveries
        WHERE recipient_email = $1
          AND message_type = 'team_role_changed'
          AND created_at >= $2`,
      [EMAIL_ACTIVE_TWO, before]
    );
    expect(emails.rows).toEqual([{ recipient_email: EMAIL_ACTIVE_TWO, status: 'pending' }]);
  });
});

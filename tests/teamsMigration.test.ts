import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Validação da migração `1739900000011_teams` contra uma CÓPIA da base
 * de dados com o fixture `tests/fixtures/teams-migration.sql`.
 *
 * O teste só corre quando `TEAMS_MIGRATION_TEST_URL` está definido, para
 * nunca tocar na base de desenvolvimento. `TEAMS_MIGRATION_EXPECT=down`
 * valida o estado depois do rollback.
 */
const connectionString = process.env.TEAMS_MIGRATION_TEST_URL;
const expectDown = process.env.TEAMS_MIGRATION_EXPECT === "down";

// Só regista o bloco da direcção que está a ser validada. Assim o
// relatório não mostra testes "skipped": a outra direcção simplesmente
// não faz parte desta execução.
const describeUp = expectDown ? null : describe;
const describeDown = expectDown ? describe : null;

if (process.env.CI && !connectionString) {
  throw new Error(
    "TEAMS_MIGRATION_TEST_URL é obrigatório em CI. Use `npm run test:teams` para preparar a base de dados.",
  );
}

const HOST_A = "dddddddd-0000-4000-8000-000000000001";
const HOST_B = "dddddddd-0000-4000-8000-000000000002";
const EVENT_1 = "cccccccc-0000-4000-8000-000000000001";
const EVENT_2 = "cccccccc-0000-4000-8000-000000000002";
const EVENT_3 = "cccccccc-0000-4000-8000-000000000003";
const EVENT_4 = "cccccccc-0000-4000-8000-000000000004";
const EVENT_5 = "cccccccc-0000-4000-8000-000000000005";
const MANAGER_ACTIVE = "bbbbbbbb-0000-4000-8000-000000000001";
const MANAGER_REVOKED = "bbbbbbbb-0000-4000-8000-000000000002";
const TASK_MANAGER_DONE = "aaaaaaaa-0000-4000-8000-000000000001";
const TASK_MANAGER_REVOKED = "aaaaaaaa-0000-4000-8000-000000000002";
const TASK_NO_MANAGER = "aaaaaaaa-0000-4000-8000-000000000003";
const TASK_OTHER_EVENT = "aaaaaaaa-0000-4000-8000-000000000004";
const TASK_PERSONAL = "aaaaaaaa-0000-4000-8000-000000000005";
const TASK_LEGACY_EVENT = "aaaaaaaa-0000-4000-8000-000000000006";
const TASK_LONG_TITLE = "aaaaaaaa-0000-4000-8000-000000000007";
const TASK_MANAGER_ONLY_EVENT = "aaaaaaaa-0000-4000-8000-000000000008";

interface TaskRow {
  id: string;
  team_id: string | null;
  event_id: string | null;
  status: string;
  title: string;
  assignee_member_id: string | null;
  completed_by_member_id: string | null;
  assignee_email: string | null;
  assignee_is_host: boolean | null;
  assignee_removed_at: Date | null;
  team_event_id: string | null;
}

describe.skipIf(!connectionString)("migração de equipas", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function task(id: string): Promise<TaskRow> {
    const { rows } = await pool.query<TaskRow>(
      `SELECT t.id,
              t.team_id,
              t.event_id,
              t.status,
              t.title,
              t.assignee_member_id,
              t.completed_by_member_id,
              m.email AS assignee_email,
              m.is_host AS assignee_is_host,
              m.removed_at AS assignee_removed_at,
              tm.event_id AS team_event_id
         FROM host_tasks t
         LEFT JOIN team_members m ON m.id = t.assignee_member_id
         LEFT JOIN teams tm ON tm.id = t.team_id
        WHERE t.id = $1`,
      [id],
    );

    expect(rows).toHaveLength(1);
    return rows[0];
  }

  describeUp?.("depois de `up`", () => {
    it('cria a equipa "Geral" só nos eventos com tarefas e responsável possível', async () => {
      const { rows } = await pool.query<{
        event_id: string;
        team_id: string | null;
      }>(
        `SELECT e.id AS event_id, t.id AS team_id
           FROM events e
           LEFT JOIN teams t
             ON t.event_id = e.id AND t.name = 'Geral' AND t.deleted_at IS NULL
          WHERE e.id = ANY($1::uuid[])`,
        [[EVENT_1, EVENT_2, EVENT_3, EVENT_4, EVENT_5]],
      );

      const byEvent = new Map(rows.map((row) => [row.event_id, row.team_id]));
      expect(byEvent.get(EVENT_1)).toBeTruthy();
      expect(byEvent.get(EVENT_2)).toBeTruthy();
      expect(byEvent.get(EVENT_5)).toBeTruthy();
      expect(byEvent.get(EVENT_3)).toBeNull();
      expect(byEvent.get(EVENT_4)).toBeNull();
    });

    it("materializa anfitrião e gestores como membros", async () => {
      const { rows } = await pool.query<{
        email: string;
        role: string;
        status: string;
        is_host: boolean;
        removed_at: Date | null;
      }>(
        `SELECT m.email, m.role, m.status, m.is_host, m.removed_at
           FROM team_members m
           JOIN teams t ON t.id = m.team_id
          WHERE t.event_id = $1 AND t.name = 'Geral'
          ORDER BY m.is_host DESC, m.email`,
        [EVENT_1],
      );

      expect(rows).toHaveLength(3);

      const host = rows.find(
        (row) => row.email === "fixture-anfitria@exemplo.pt",
      );
      expect(host).toMatchObject({
        role: "gestor",
        status: "ativo",
        is_host: true,
      });
      expect(host?.removed_at).toBeNull();

      const active = rows.find(
        (row) => row.email === "fixture-gestor@exemplo.pt",
      );
      expect(active).toMatchObject({
        role: "gestor",
        status: "ativo",
        is_host: false,
      });
      expect(active?.removed_at).toBeNull();

      const revoked = rows.find(
        (row) => row.email === "fixture-revogado@exemplo.pt",
      );
      expect(revoked).toMatchObject({ role: "gestor", is_host: false });
      expect(revoked?.removed_at).not.toBeNull();
    });

    it("preserva as tarefas e deixa sem equipa as que não têm responsável", async () => {
      const { rows } = await pool.query<{ total: string; com_equipa: string }>(
        `SELECT count(*)::text AS total,
                count(team_id)::text AS com_equipa
           FROM host_tasks
          WHERE id::text LIKE 'aaaaaaaa-0000-4000-8000-%'`,
      );

      expect(rows[0]).toEqual({ total: "8", com_equipa: "6" });
    });

    it("nunca deixa uma tarefa com equipa sem responsável", async () => {
      const { rows } = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total
           FROM host_tasks
          WHERE team_id IS NOT NULL
            AND assignee_member_id IS NULL`,
      );

      expect(rows[0].total).toBe("0");
    });

    it("atribui a tarefa do gestor activo e regista-o como autor da conclusão", async () => {
      const row = await task(TASK_MANAGER_DONE);

      expect(row.status).toBe("concluida");
      expect(row.assignee_email).toBe("fixture-gestor@exemplo.pt");
      expect(row.completed_by_member_id).toBe(row.assignee_member_id);
      expect(row.completed_by_member_id).not.toBeNull();
      expect(row.team_event_id).toBe(EVENT_1);
    });

    it("mantém o gestor revogado como responsável sem acesso", async () => {
      const row = await task(TASK_MANAGER_REVOKED);

      expect(row.status).toBe("por_fazer");
      expect(row.assignee_email).toBe("fixture-revogado@exemplo.pt");
      expect(row.assignee_removed_at).not.toBeNull();
    });

    it("usa o anfitrião como responsável por omissão", async () => {
      const row = await task(TASK_NO_MANAGER);
      expect(row.assignee_email).toBe("fixture-anfitria@exemplo.pt");
      expect(row.assignee_is_host).toBe(true);

      const other = await task(TASK_OTHER_EVENT);
      expect(other.assignee_email).toBe("fixture-anfitriao-b@exemplo.pt");
      expect(other.status).toBe("concluida");
    });

    it("usa o gestor activo quando o evento não tem anfitrião", async () => {
      const row = await task(TASK_MANAGER_ONLY_EVENT);

      expect(row.team_event_id).toBe(EVENT_5);
      expect(row.assignee_email).toBe(
        "fixture-gestor-sem-anfitriao@exemplo.pt",
      );
      expect(row.assignee_is_host).toBe(false);
    });

    it('deixa as tarefas sem responsável possível em "Pessoais (legado)"', async () => {
      const personal = await task(TASK_PERSONAL);
      expect(personal.team_id).toBeNull();
      expect(personal.event_id).toBeNull();
      expect(personal.title).toBe("Ligar à avó");
      expect(personal.status).toBe("por_fazer");

      const orphan = await task(TASK_LEGACY_EVENT);
      expect(orphan.team_id).toBeNull();
      expect(orphan.event_id).toBe(EVENT_3);
      expect(orphan.assignee_member_id).toBeNull();
    });

    it("aceita um título com 80 caracteres", async () => {
      const row = await task(TASK_LONG_TITLE);
      expect(row.title).toHaveLength(80);
    });

    it("impede uma tarefa com equipa sem responsável", async () => {
      await expect(
        pool.query(
          `INSERT INTO host_tasks (host_id, event_id, team_id, title, created_by_host_id)
           SELECT $1, $2, t.id, 'Tarefa sem responsável', $1
             FROM teams t
            WHERE t.event_id = $2 AND t.name = 'Geral'`,
          [HOST_A, EVENT_1],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("continua a aceitar o código antigo: inserir só com label", async () => {
      const { rows } = await pool.query<{
        id: string;
        title: string;
        label: string;
        status: string;
        done: boolean;
        priority: string;
        created_by_host_id: string;
      }>(
        `INSERT INTO host_tasks (host_id, event_id, label)
         VALUES ($1, $2, 'Tarefa criada só com label')
         RETURNING id, title, label, status, done, priority, created_by_host_id`,
        [HOST_A, EVENT_1],
      );

      const inserted = rows[0];
      expect(inserted.title).toBe("Tarefa criada só com label");
      expect(inserted.status).toBe("por_fazer");
      expect(inserted.done).toBe(false);
      expect(inserted.priority).toBe("normal");
      expect(inserted.created_by_host_id).toBe(HOST_A);

      const updated = await pool.query<{ title: string; label: string }>(
        `UPDATE host_tasks
            SET label = 'Label atualizado pelo código antigo', updated_at = now()
          WHERE id = $1
        RETURNING title, label`,
        [inserted.id],
      );

      expect(updated.rows[0]).toEqual({
        title: "Label atualizado pelo código antigo",
        label: "Label atualizado pelo código antigo",
      });

      await pool.query(`DELETE FROM host_tasks WHERE id = $1`, [inserted.id]);
    });

    it("continua a aceitar o código antigo: alternar done sincroniza status sem inventar o autor", async () => {
      const done = await pool.query<{
        status: string;
        done: boolean;
        completed_by_member_id: string | null;
        assignee_member_id: string | null;
      }>(
        `UPDATE host_tasks
            SET done = true, completed_at = now(), updated_at = now()
          WHERE id = $1
        RETURNING status, done, completed_by_member_id, assignee_member_id`,
        [TASK_MANAGER_REVOKED],
      );

      expect(done.rows[0].status).toBe("concluida");
      expect(done.rows[0].done).toBe(true);
      // O trigger sincroniza colunas, mas não assume quem concluiu.
      expect(done.rows[0].assignee_member_id).not.toBeNull();
      expect(done.rows[0].completed_by_member_id).toBeNull();

      const explicit = await pool.query<{ completed_by_member_id: string | null }>(
        `UPDATE host_tasks
            SET completed_by_member_id = assignee_member_id, updated_at = now()
          WHERE id = $1
        RETURNING completed_by_member_id`,
        [TASK_MANAGER_REVOKED],
      );
      expect(explicit.rows[0].completed_by_member_id).not.toBeNull();

      const undone = await pool.query<{
        status: string;
        done: boolean;
        completed_at: Date | null;
        completed_by_member_id: string | null;
      }>(
        `UPDATE host_tasks
            SET done = false, completed_at = null, updated_at = now()
          WHERE id = $1
        RETURNING status, done, completed_at, completed_by_member_id`,
        [TASK_MANAGER_REVOKED],
      );

      expect(undone.rows[0]).toMatchObject({
        status: "por_fazer",
        done: false,
        completed_at: null,
        completed_by_member_id: null,
      });
    });

    it("materializa anfitrião e gestores ao criar a primeira equipa de um evento", async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO teams (event_id, name, category, created_by_host_id)
         VALUES ($1, 'Equipa Nova', 'logistica', $2)
         RETURNING id`,
        [EVENT_4, HOST_A],
      );

      const teamId = rows[0].id;

      try {
        await pool.query(`SELECT team_materialize_event_staff($1)`, [teamId]);

        const members = await pool.query<{
          email: string;
          role: string;
          is_host: boolean;
        }>(
          `SELECT email, role, is_host
             FROM team_members
            WHERE team_id = $1
            ORDER BY is_host DESC, email`,
          [teamId],
        );

        expect(members.rows).toEqual([
          {
            email: "fixture-anfitria@exemplo.pt",
            role: "gestor",
            is_host: true,
          },
          {
            email: "fixture-gestor-e4@exemplo.pt",
            role: "gestor",
            is_host: false,
          },
        ]);
      } finally {
        await pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
      }
    });

    it("impede mover uma tarefa para a equipa de outro evento", async () => {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM teams WHERE event_id = $1 AND name = 'Geral'`,
        [EVENT_2],
      );

      await expect(
        pool.query(`UPDATE host_tasks SET team_id = $1 WHERE id = $2`, [
          rows[0].id,
          TASK_MANAGER_DONE,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("impede duas equipas com o mesmo nome no mesmo evento", async () => {
      await expect(
        pool.query(`INSERT INTO teams (event_id, name) VALUES ($1, 'Geral')`, [
          EVENT_1,
        ]),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("rejeita estados de tarefa fora do domínio", async () => {
      await expect(
        pool.query(`UPDATE host_tasks SET status = 'feito' WHERE id = $1`, [
          TASK_NO_MANAGER,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejeita papéis e estados de membro fora do domínio", async () => {
      await expect(
        pool.query(
          `INSERT INTO team_members (team_id, email, role)
           SELECT id, 'papel-invalido@exemplo.pt', 'chefe'
             FROM teams WHERE event_id = $1 AND name = 'Geral'`,
          [EVENT_1],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describeDown?.("depois de `down`", () => {
    it("remove as tabelas novas", async () => {
      const { rows } = await pool.query<{
        teams: string | null;
        members: string | null;
      }>(
        `SELECT to_regclass('public.teams')::text AS teams,
                to_regclass('public.team_members')::text AS members`,
      );

      expect(rows[0]).toEqual({ teams: null, members: null });
    });

    it("remove as colunas novas de host_tasks", async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'host_tasks'
            AND column_name IN (
              'team_id', 'assignee_member_id', 'title', 'description',
              'due_date', 'priority', 'status', 'created_by_host_id',
              'completed_by_member_id'
            )`,
      );

      expect(rows).toEqual([]);
    });

    it("restaura done, completed_at e manager_id sem perder tarefas", async () => {
      const { rows } = await pool.query<{
        id: string;
        done: boolean;
        manager_id: string | null;
        label: string;
        completed_at: Date | null;
      }>(
        `SELECT id, done, manager_id, label, completed_at
           FROM host_tasks
          WHERE id::text LIKE 'aaaaaaaa-0000-4000-8000-%'
          ORDER BY id`,
      );

      expect(rows).toHaveLength(8);

      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(TASK_MANAGER_DONE)).toMatchObject({
        done: true,
        manager_id: MANAGER_ACTIVE,
      });
      expect(byId.get(TASK_MANAGER_REVOKED)).toMatchObject({
        done: false,
        manager_id: MANAGER_REVOKED,
      });
      expect(byId.get(TASK_NO_MANAGER)?.manager_id).toBeNull();
      expect(byId.get(TASK_OTHER_EVENT)?.done).toBe(true);
      expect(byId.get(TASK_PERSONAL)?.label).toBe("Ligar à avó");
      expect(byId.get(TASK_LONG_TITLE)?.label).toHaveLength(80);
      expect(byId.get(TASK_LEGACY_EVENT)?.manager_id).toBeNull();
      // O responsável sem anfitrião era o gestor activo do evento.
      expect(byId.get(TASK_MANAGER_ONLY_EVENT)?.manager_id).toBe(
        "bbbbbbbb-0000-4000-8000-000000000004",
      );
      expect(byId.get(TASK_NO_MANAGER)?.completed_at).toBeNull();
    });

    it("mantém a contagem total de tarefas", async () => {
      const { rows } = await pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM host_tasks`,
      );

      expect(Number(rows[0].total)).toBeGreaterThanOrEqual(8);
    });
  });
});

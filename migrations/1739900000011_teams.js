/**
 * Equipas por evento, membros e evolução das tarefas.
 *
 * Contexto (Prompt 5):
 * - uma equipa pertence sempre a um evento e tem nome, categoria de
 *   actividade, descrição e autor;
 * - um membro pertence a uma equipa, pode ser gestor ou membro, estar
 *   activo ou com convite pendente e ter entrado por convite ou por
 *   e-mail;
 * - o anfitrião do evento é gestor implícito de todas as equipas e é
 *   materializado como membro (`is_host`), tal como os gestores do
 *   evento. Assim o responsável de uma tarefa é sempre uma única FK;
 * - cada tarefa pertence a uma equipa e o evento é derivado dela por
 *   trigger, nunca editável.
 *
 * Tarefas antigas:
 * - por cada evento com tarefas sem equipa é criada a equipa "Geral"
 *   (categoria "Outra"), mas só quando existe pelo menos um responsável
 *   possível (anfitrião ou gestor activo). Sem responsável, a tarefa
 *   fica sem equipa, na secção "Pessoais (legado)" do criador;
 * - o responsável por omissão é o anfitrião; se a tarefa estava
 *   atribuída a um gestor, o responsável passa a ser o membro com esse
 *   e-mail; sem anfitrião, assume o primeiro gestor activo;
 * - tarefas sem evento ficam fora das equipas (`team_id` nulo).
 *
 * Compatibilidade durante o deploy:
 * - o código antigo só conhece `label`/`done`/`manager_id`. O trigger
 *   `host_tasks_sync_legacy_columns` mantém `label`↔`title` e
 *   `done`↔`status` sincronizados e preenche `created_by_host_id` e
 *   `completed_at`, até a Fase 2 substituir o código;
 * - o trigger NUNCA decide quem concluiu: `completed_by_member_id` é
 *   definido pelo serviço, depois de validar que a conta autenticada é
 *   o responsável. O trigger apenas limpa a coluna ao reabrir.
 *
 * A remoção de equipas é lógica (`deleted_at`) e a remoção de membros
 * também (`removed_at`), para nunca quebrar a FK do responsável de uma
 * tarefa. A migração é reversível: `down` reconstrói `done`,
 * `completed_at` e `manager_id` antes de remover as colunas novas.
 */
exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE teams (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name               text NOT NULL,
      category           text NOT NULL DEFAULT 'outra',
      description        text,
      created_by_host_id uuid REFERENCES hosts(id) ON DELETE SET NULL,
      deleted_at         timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT teams_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
      CONSTRAINT teams_category_check CHECK (
        category IN ('logistica', 'decoracao', 'musica', 'catering', 'rececao', 'outra')
      )
    );

    CREATE UNIQUE INDEX teams_event_name_unique
      ON teams (event_id, lower(btrim(name)))
      WHERE deleted_at IS NULL;

    CREATE INDEX teams_event_id_idx ON teams (event_id) WHERE deleted_at IS NULL;
    CREATE INDEX teams_created_by_idx ON teams (created_by_host_id);

    CREATE TABLE team_members (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id            uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      host_id            uuid REFERENCES hosts(id) ON DELETE SET NULL,
      email              citext NOT NULL,
      display_name       text,
      role               text NOT NULL DEFAULT 'membro',
      status             text NOT NULL DEFAULT 'convite_pendente',
      origin             text NOT NULL DEFAULT 'email',
      is_host            boolean NOT NULL DEFAULT false,
      invited_by_host_id uuid REFERENCES hosts(id) ON DELETE SET NULL,
      joined_at          timestamptz,
      removed_at         timestamptz,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT team_members_role_check CHECK (role IN ('gestor', 'membro')),
      CONSTRAINT team_members_status_check CHECK (status IN ('ativo', 'convite_pendente')),
      CONSTRAINT team_members_origin_check CHECK (origin IN ('convidado', 'email')),
      CONSTRAINT team_members_host_role_check CHECK (NOT is_host OR role = 'gestor')
    );

    CREATE UNIQUE INDEX team_members_team_email_unique
      ON team_members (team_id, email)
      WHERE removed_at IS NULL;

    CREATE UNIQUE INDEX team_members_one_host
      ON team_members (team_id)
      WHERE is_host;

    CREATE INDEX team_members_team_id_idx
      ON team_members (team_id) WHERE removed_at IS NULL;
    CREATE INDEX team_members_host_id_idx
      ON team_members (host_id) WHERE host_id IS NOT NULL;
    CREATE INDEX team_members_email_idx ON team_members (email);

    ALTER TABLE host_tasks
      ADD COLUMN team_id uuid REFERENCES teams(id) ON DELETE RESTRICT,
      ADD COLUMN assignee_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
      ADD COLUMN title text,
      ADD COLUMN description text,
      ADD COLUMN due_date date,
      ADD COLUMN priority text NOT NULL DEFAULT 'normal',
      ADD COLUMN status text NOT NULL DEFAULT 'por_fazer',
      ADD COLUMN created_by_host_id uuid REFERENCES hosts(id) ON DELETE CASCADE,
      ADD COLUMN completed_by_member_id uuid REFERENCES team_members(id) ON DELETE SET NULL,
      ADD COLUMN archived_at timestamptz;

    UPDATE host_tasks
       SET title = label,
           status = CASE WHEN done THEN 'concluida' ELSE 'por_fazer' END,
           created_by_host_id = host_id;

    -- Materializa o anfitrião e os gestores activos do evento como
    -- membros da equipa. A Fase 2 chama esta função na mesma transação
    -- que cria a equipa ou altera o acesso de um gestor.
    CREATE OR REPLACE FUNCTION team_materialize_event_staff(p_team_id uuid)
    RETURNS void AS $$
    DECLARE
      v_event_id uuid;
    BEGIN
      SELECT event_id INTO v_event_id FROM teams WHERE id = p_team_id;

      IF v_event_id IS NULL THEN
        RAISE EXCEPTION 'A equipa indicada não existe.' USING ERRCODE = '23503';
      END IF;

      INSERT INTO team_members (
        team_id, host_id, email, display_name, role, status, origin,
        is_host, joined_at
      )
      SELECT p_team_id,
             e.host_id,
             h.email,
             p.display_name,
             'gestor',
             'ativo',
             'email',
             true,
             now()
        FROM events e
        JOIN hosts h ON h.id = e.host_id
        LEFT JOIN host_profiles p ON p.host_id = h.id
       WHERE e.id = v_event_id
      ON CONFLICT DO NOTHING;

      INSERT INTO team_members (
        team_id, host_id, email, display_name, role, status, origin,
        is_host, joined_at
      )
      SELECT p_team_id,
             h.id,
             m.email,
             p.display_name,
             'gestor',
             'ativo',
             'email',
             false,
             COALESCE(m.created_at, now())
        FROM event_managers m
        LEFT JOIN hosts h ON h.email = m.email AND h.status = 'active'
        LEFT JOIN host_profiles p ON p.host_id = h.id
       WHERE m.event_id = v_event_id
         AND m.revoked_at IS NULL
      ON CONFLICT DO NOTHING;
    END;
    $$ LANGUAGE plpgsql;

    -- Equipa "Geral" por evento com tarefas antigas e com pelo menos um
    -- responsável possível (anfitrião ou gestor activo). Sem ninguém
    -- elegível, a tarefa fica sem equipa em vez de ficar sem responsável.
    INSERT INTO teams (event_id, name, category, description, created_by_host_id)
    SELECT DISTINCT
           t.event_id,
           'Geral',
           'outra',
           'Equipa criada automaticamente para receber as tarefas antigas.',
           e.host_id
      FROM host_tasks t
      JOIN events e ON e.id = t.event_id
     WHERE t.event_id IS NOT NULL
       AND (
         e.host_id IS NOT NULL
         OR EXISTS (
           SELECT 1
             FROM event_managers m
            WHERE m.event_id = e.id
              AND m.revoked_at IS NULL
         )
       )
    ON CONFLICT DO NOTHING;

    SELECT team_materialize_event_staff(id)
      FROM teams
     WHERE name = 'Geral'
       AND deleted_at IS NULL;

    -- Gestores revogados que ainda são responsáveis por tarefas antigas:
    -- a linha fica removida para preservar a FK e o histórico.
    INSERT INTO team_members (
      team_id, host_id, email, display_name, role, status, origin,
      is_host, joined_at, removed_at
    )
    SELECT DISTINCT
           tm.id,
           h.id,
           m.email,
           p.display_name,
           'gestor',
           'ativo',
           'email',
           false,
           COALESCE(m.created_at, now()),
           COALESCE(m.revoked_at, now())
      FROM host_tasks t
      JOIN event_managers m ON m.id = t.manager_id
      JOIN teams tm
        ON tm.event_id = t.event_id
       AND tm.name = 'Geral'
       AND tm.deleted_at IS NULL
      LEFT JOIN hosts h ON h.email = m.email AND h.status = 'active'
      LEFT JOIN host_profiles p ON p.host_id = h.id
     WHERE m.revoked_at IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- Move as tarefas antigas para a equipa "Geral" do respectivo evento.
    UPDATE host_tasks t
       SET team_id = tm.id
      FROM teams tm
     WHERE t.event_id = tm.event_id
       AND tm.name = 'Geral'
       AND tm.deleted_at IS NULL
       AND t.team_id IS NULL;

    -- Responsável: gestor antigo, quando existir como membro.
    UPDATE host_tasks t
       SET assignee_member_id = m.id
      FROM event_managers em, team_members m
     WHERE em.id = t.manager_id
       AND m.team_id = t.team_id
       AND m.email = em.email;

    -- Sem gestor antigo: anfitrião primeiro, depois o primeiro gestor
    -- activo. Só fica sem responsável a tarefa sem equipa.
    UPDATE host_tasks t
       SET assignee_member_id = (
         SELECT m.id
           FROM team_members m
          WHERE m.team_id = t.team_id
            AND m.removed_at IS NULL
          ORDER BY m.is_host DESC, (m.role = 'gestor') DESC, m.created_at, m.id
          LIMIT 1
       )
     WHERE t.team_id IS NOT NULL
       AND t.assignee_member_id IS NULL;

    UPDATE host_tasks
       SET completed_by_member_id = assignee_member_id
     WHERE status = 'concluida'
       AND assignee_member_id IS NOT NULL;

    ALTER TABLE host_tasks
      ALTER COLUMN title SET NOT NULL,
      ALTER COLUMN created_by_host_id SET NOT NULL;

    ALTER TABLE host_tasks
      ADD CONSTRAINT host_tasks_title_check
        CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
      ADD CONSTRAINT host_tasks_priority_check
        CHECK (priority IN ('baixa', 'normal', 'alta')),
      ADD CONSTRAINT host_tasks_status_check
        CHECK (status IN ('por_fazer', 'em_curso', 'concluida')),
      ADD CONSTRAINT host_tasks_team_event_check
        CHECK (team_id IS NULL OR event_id IS NOT NULL),
      ADD CONSTRAINT host_tasks_team_assignee_check
        CHECK (team_id IS NULL OR assignee_member_id IS NOT NULL);

    CREATE INDEX host_tasks_team_id_idx
      ON host_tasks (team_id) WHERE team_id IS NOT NULL;
    CREATE INDEX host_tasks_assignee_idx
      ON host_tasks (assignee_member_id) WHERE assignee_member_id IS NOT NULL;
    CREATE INDEX host_tasks_status_idx ON host_tasks (status);
    CREATE INDEX host_tasks_due_date_idx
      ON host_tasks (due_date)
      WHERE due_date IS NOT NULL AND status <> 'concluida';

    -- O evento de uma tarefa é sempre o evento da equipa.
    CREATE OR REPLACE FUNCTION host_tasks_sync_team_event()
    RETURNS trigger AS $$
    DECLARE
      team_event uuid;
    BEGIN
      IF NEW.team_id IS NOT NULL THEN
        SELECT event_id INTO team_event FROM teams WHERE id = NEW.team_id;

        IF team_event IS NULL THEN
          RAISE EXCEPTION 'A equipa indicada não existe.'
            USING ERRCODE = '23503';
        END IF;

        IF TG_OP = 'UPDATE'
           AND OLD.event_id IS NOT NULL
           AND OLD.event_id <> team_event THEN
          RAISE EXCEPTION 'O evento da tarefa é derivado da equipa e não pode ser alterado.'
            USING ERRCODE = '23514';
        END IF;

        NEW.event_id := team_event;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER host_tasks_sync_team_event
      BEFORE INSERT OR UPDATE OF team_id, event_id ON host_tasks
      FOR EACH ROW EXECUTE FUNCTION host_tasks_sync_team_event();

    -- Compatibilidade com o código antigo: mantém label↔title e
    -- done↔status sincronizados. O trigger não preenche
    -- completed_by_member_id: essa decisão pertence ao serviço, que
    -- valida a permissão antes de concluir. Ao reabrir, a coluna é
    -- limpa porque deixa de haver uma conclusão.
    CREATE OR REPLACE FUNCTION host_tasks_sync_legacy_columns()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        IF NEW.title IS NULL THEN
          NEW.title := NEW.label;
        END IF;

        IF NEW.label IS NULL THEN
          NEW.label := NEW.title;
        END IF;

        IF NEW.title IS NULL THEN
          RAISE EXCEPTION 'A tarefa precisa de um título.'
            USING ERRCODE = '23514';
        END IF;

        NEW.created_by_host_id := COALESCE(NEW.created_by_host_id, NEW.host_id);

        IF NEW.done IS TRUE
           AND NEW.status = 'por_fazer'
           AND NEW.completed_at IS NULL THEN
          NEW.status := 'concluida';
        END IF;
      ELSE
        IF NEW.title IS DISTINCT FROM OLD.title THEN
          NEW.label := NEW.title;
        ELSIF NEW.label IS DISTINCT FROM OLD.label THEN
          NEW.title := NEW.label;
        END IF;

        IF NEW.status IS DISTINCT FROM OLD.status THEN
          NEW.done := (NEW.status = 'concluida');
        ELSIF NEW.done IS DISTINCT FROM OLD.done THEN
          NEW.status := CASE WHEN NEW.done THEN 'concluida' ELSE 'por_fazer' END;
        END IF;
      END IF;

      IF NEW.status = 'concluida' THEN
        NEW.done := true;
        NEW.completed_at := COALESCE(NEW.completed_at, now());
        -- completed_by_member_id é definido pelo serviço, que já
        -- validou que a conta é o responsável. O trigger não assume
        -- quem é o actor.
      ELSE
        NEW.done := false;
        NEW.completed_at := NULL;
        NEW.completed_by_member_id := NULL;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER host_tasks_sync_legacy_columns
      BEFORE INSERT OR UPDATE ON host_tasks
      FOR EACH ROW EXECUTE FUNCTION host_tasks_sync_legacy_columns();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Reconstrói o modelo antigo antes de remover as colunas novas.
    UPDATE host_tasks t
       SET done = (t.status = 'concluida'),
           completed_at = CASE
             WHEN t.status = 'concluida'
               THEN COALESCE(t.completed_at, t.updated_at)
             ELSE NULL
           END,
           manager_id = (
             SELECT em.id
               FROM event_managers em
               JOIN team_members m ON m.id = t.assignee_member_id
              WHERE em.event_id = t.event_id
                AND em.email = m.email
              LIMIT 1
           );

    DROP TRIGGER IF EXISTS host_tasks_sync_legacy_columns ON host_tasks;
    DROP TRIGGER IF EXISTS host_tasks_sync_team_event ON host_tasks;
    DROP FUNCTION IF EXISTS host_tasks_sync_legacy_columns();
    DROP FUNCTION IF EXISTS host_tasks_sync_team_event();
    DROP FUNCTION IF EXISTS team_materialize_event_staff(uuid);

    DROP INDEX IF EXISTS host_tasks_due_date_idx;
    DROP INDEX IF EXISTS host_tasks_status_idx;
    DROP INDEX IF EXISTS host_tasks_assignee_idx;
    DROP INDEX IF EXISTS host_tasks_team_id_idx;

    ALTER TABLE host_tasks
      DROP CONSTRAINT IF EXISTS host_tasks_team_assignee_check,
      DROP CONSTRAINT IF EXISTS host_tasks_team_event_check,
      DROP CONSTRAINT IF EXISTS host_tasks_status_check,
      DROP CONSTRAINT IF EXISTS host_tasks_priority_check,
      DROP CONSTRAINT IF EXISTS host_tasks_title_check,
      DROP COLUMN IF EXISTS archived_at,
      DROP COLUMN IF EXISTS completed_by_member_id,
      DROP COLUMN IF EXISTS created_by_host_id,
      DROP COLUMN IF EXISTS status,
      DROP COLUMN IF EXISTS priority,
      DROP COLUMN IF EXISTS due_date,
      DROP COLUMN IF EXISTS description,
      DROP COLUMN IF EXISTS title,
      DROP COLUMN IF EXISTS assignee_member_id,
      DROP COLUMN IF EXISTS team_id;

    DROP TABLE IF EXISTS team_members;
    DROP TABLE IF EXISTS teams;
  `);
};

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import { Client, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import catalog from '../src/assets/templates/system-templates.json';

/**
 * Validação real (PostgreSQL) da migração do catálogo Bloco 15B.
 *
 * Cada execução cria uma DB descartável e aplica apenas esta migração através
 * do mesmo `node-pg-migrate` usado em produção. O esquema criado abaixo é o
 * subconjunto das tabelas/colunas relevantes do baseline (slug UNIQUE,
 * manifest/kind em event_templates e events.template_id com FK).
 *
 * A URL administrativa pode ser sobrescrita com
 * BLOCO15B_TEST_ADMIN_DATABASE_URL; por omissão aponta para o PostgreSQL
 * local do docker-compose.
 */
const adminDatabaseUrl =
  process.env['BLOCO15B_TEST_ADMIN_DATABASE_URL'] ??
  'postgres://apupu_user:apupu_password@localhost:5433/postgres';
const databaseName = `apupu_bloco15b_${randomUUID().replaceAll('-', '')}`;

function databaseUrlFor(name: string): string {
  const url = new URL(adminDatabaseUrl);
  url.pathname = `/${name}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

const testDatabaseUrl = databaseUrlFor(databaseName);
const migrationName = '1739900000040_bloco15b_catalog';
const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

const catalogSlugs = catalog.map((entry) => entry.slug);
const defaultThemes = [{ mode: 'light', palette: 'default' }];

type TemplateRow = QueryResultRow & {
  slug: string;
  name: string;
  description: string | null;
  supported_fields: unknown;
  themes: unknown;
  is_active: boolean;
  sort_order: number;
  manifest: unknown;
  kind: string;
};

let adminClient: Client | undefined;
let db: Client | undefined;

function migrate(direction: 'up' | 'down') {
  return runner({
    databaseUrl: testDatabaseUrl,
    dir: migrationsDir,
    file: migrationName,
    direction,
    migrationsTable: 'pgmigrations',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
}

beforeAll(async () => {
  adminClient = new Client({ connectionString: adminDatabaseUrl });
  await adminClient.connect();
  await adminClient.query(`CREATE DATABASE "${databaseName}"`);

  db = new Client({ connectionString: testDatabaseUrl });
  await db.connect();
  await db.query(`
    CREATE TABLE event_templates (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug              text NOT NULL UNIQUE,
      name              text NOT NULL,
      description       text,
      preview_image_url text,
      supported_fields  jsonb NOT NULL DEFAULT '[]'::jsonb,
      themes            jsonb NOT NULL DEFAULT '[]'::jsonb,
      is_active         boolean NOT NULL DEFAULT true,
      sort_order        integer NOT NULL DEFAULT 0,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      manifest          jsonb NOT NULL DEFAULT '{}'::jsonb,
      kind              text NOT NULL DEFAULT 'user',
      CONSTRAINT event_templates_kind_check CHECK (kind IN ('system', 'user'))
    );

    CREATE TABLE events (
      id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      manage_token_hash text NOT NULL UNIQUE,
      title             text NOT NULL,
      template_id       uuid REFERENCES event_templates(id) ON DELETE SET NULL,
      created_at        timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO event_templates (slug, name, description, kind)
    VALUES ('base', 'Base', 'Template legado que não deve ser alterado', 'user');
  `);
});

afterAll(async () => {
  await db?.end();
  db = undefined;
  if (adminClient) {
    await adminClient.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await adminClient.end();
    adminClient = undefined;
  }
});

describe('Bloco 15B — migração do catálogo em PostgreSQL real', () => {
  it('faz up (19 inserts), upsert idempotente e down preservando template em uso', async () => {
    expect(db).toBeDefined();
    const client = db!;

    // 1. up: inserted 19 templates de sistema, sem tocar noutros slugs.
    const up = await migrate('up');
    expect(up.map((migration) => migration.name)).toEqual([migrationName]);

    const inserted = await client.query<TemplateRow>(
      `SELECT slug, name, description, supported_fields, themes, is_active, sort_order, manifest, kind
         FROM event_templates WHERE slug = ANY($1::text[]) ORDER BY sort_order`,
      [catalogSlugs],
    );
    expect(inserted.rowCount).toBe(19);

    for (const entry of catalog) {
      const row = inserted.rows.find((candidate) => candidate.slug === entry.slug);
      expect(row, `template ${entry.slug} ausente após up`).toBeDefined();
      expect(row!.kind).toBe('system');
      expect(row!.name).toBe(entry.name);
      expect(row!.description).toBe(entry.description);
      expect(row!.supported_fields).toEqual(entry.supportedFields);
      expect(row!.themes).toEqual(defaultThemes);
      expect(row!.is_active).toBe(true);
      expect(row!.sort_order).toBe(entry.sortOrder);
      expect(row!.manifest).toEqual(entry.manifest);
    }

    const untouched = await client.query<{ slug: string; name: string; kind: string }>(
      `SELECT slug, name, kind FROM event_templates WHERE slug = 'base'`,
    );
    expect(untouched.rows).toEqual([{ slug: 'base', name: 'Base', kind: 'user' }]);

    // 2. up novamente: corrige alterações locais sem duplicar linhas.
    const driftedSlug = catalogSlugs[0]!;
    const drifted = catalog.find((entry) => entry.slug === driftedSlug)!;
    await client.query(
      `UPDATE event_templates
          SET name = 'Nome alterado localmente', manifest = '{}'::jsonb,
              supported_fields = '[]'::jsonb, themes = '[]'::jsonb,
              is_active = false, sort_order = -1, kind = 'user'
        WHERE slug = $1`,
      [driftedSlug],
    );

    // O runner não reaplica migrações já marcadas; remover a marca simula
    // uma reexecução explícita do mesmo `up` (ex.: reparação manual).
    await client.query(`DELETE FROM pgmigrations WHERE name = $1`, [migrationName]);
    const secondUp = await migrate('up');
    expect(secondUp.map((migration) => migration.name)).toEqual([migrationName]);

    const repaired = await client.query<TemplateRow>(
      `SELECT name, description, supported_fields, themes, is_active, sort_order, manifest, kind
         FROM event_templates WHERE slug = $1`,
      [driftedSlug],
    );
    expect(repaired.rows[0]).toMatchObject({
      name: drifted.name,
      description: drifted.description,
      supported_fields: drifted.supportedFields,
      themes: defaultThemes,
      is_active: true,
      sort_order: drifted.sortOrder,
      manifest: drifted.manifest,
      kind: 'system',
    });

    const total = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM event_templates`,
    );
    expect(total.rows[0]?.count).toBe(20); // 19 do catálogo + 1 legado

    // 3. down: um template em uso não é removido; os restantes são.
    const inUseSlug = catalogSlugs[1]!;
    await client.query(
      `INSERT INTO events (manage_token_hash, title, template_id)
       VALUES ($1, $2, (SELECT id FROM event_templates WHERE slug = $3))`,
      ['migration-test-token', 'Evento com template em uso', inUseSlug],
    );

    const down = await migrate('down');
    expect(down.map((migration) => migration.name)).toEqual([migrationName]);

    const remaining = await client.query<{ slug: string; kind: string }>(
      `SELECT slug, kind FROM event_templates ORDER BY slug`,
    );
    expect(remaining.rows.map((row) => row.slug)).toEqual(['base', inUseSlug].sort());
    expect(remaining.rows.find((row) => row.slug === inUseSlug)?.kind).toBe('system');
    expect(remaining.rows.find((row) => row.slug === 'base')?.kind).toBe('user');

    // A coluna kind (e a sua constraint) continuam intactas após o down.
    const kindColumn = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'event_templates' AND column_name = 'kind'`,
    );
    expect(kindColumn.rowCount).toBe(1);
    const kindConstraint = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'event_templates'::regclass AND conname = 'event_templates_kind_check'`,
    );
    expect(kindConstraint.rowCount).toBe(1);

    const eventStillLinked = await client.query<{ slug: string }>(
      `SELECT t.slug FROM events e JOIN event_templates t ON t.id = e.template_id
        WHERE e.manage_token_hash = $1`,
      ['migration-test-token'],
    );
    expect(eventStillLinked.rows[0]?.slug).toBe(inUseSlug);

    // 4. round-trip: um novo up restaura o catálogo completo.
    const restoredUp = await migrate('up');
    expect(restoredUp.map((migration) => migration.name)).toEqual([migrationName]);
    const restoredCount = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM event_templates WHERE slug = ANY($1::text[])`,
      [catalogSlugs],
    );
    expect(restoredCount.rows[0]?.count).toBe(19);
  });
});

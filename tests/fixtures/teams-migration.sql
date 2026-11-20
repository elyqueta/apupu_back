-- Dados de fixture para validar a migração de equipas/tarefas (Prompt 5).
-- Corre sempre numa cópia da base de dados, nunca em produção.
-- Os UUIDs são fixos para que os testes possam afirmar sobre linhas concretas.

BEGIN;

DELETE FROM host_tasks WHERE id IN (
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000002',
  'aaaaaaaa-0000-4000-8000-000000000003',
  'aaaaaaaa-0000-4000-8000-000000000004',
  'aaaaaaaa-0000-4000-8000-000000000005',
  'aaaaaaaa-0000-4000-8000-000000000006',
  'aaaaaaaa-0000-4000-8000-000000000007',
  'aaaaaaaa-0000-4000-8000-000000000008'
);

DELETE FROM event_managers WHERE id IN (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'bbbbbbbb-0000-4000-8000-000000000003',
  'bbbbbbbb-0000-4000-8000-000000000004'
);

DELETE FROM events WHERE id IN (
  'cccccccc-0000-4000-8000-000000000001',
  'cccccccc-0000-4000-8000-000000000002',
  'cccccccc-0000-4000-8000-000000000003',
  'cccccccc-0000-4000-8000-000000000004',
  'cccccccc-0000-4000-8000-000000000005'
);

DELETE FROM host_profiles WHERE host_id IN (
  'dddddddd-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000002',
  'dddddddd-0000-4000-8000-000000000003'
);

DELETE FROM hosts WHERE id IN (
  'dddddddd-0000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000002',
  'dddddddd-0000-4000-8000-000000000003'
);

INSERT INTO hosts (id, email, password_hash, email_verified_at, status) VALUES
  ('dddddddd-0000-4000-8000-000000000001', 'fixture-anfitria@exemplo.pt', 'x', now(), 'active'),
  ('dddddddd-0000-4000-8000-000000000002', 'fixture-anfitriao-b@exemplo.pt', 'x', now(), 'active'),
  ('dddddddd-0000-4000-8000-000000000003', 'fixture-gestor@exemplo.pt', 'x', now(), 'active');

INSERT INTO host_profiles (host_id, display_name) VALUES
  ('dddddddd-0000-4000-8000-000000000001', 'Ana Fixture'),
  ('dddddddd-0000-4000-8000-000000000002', 'Bruno Fixture'),
  ('dddddddd-0000-4000-8000-000000000003', 'Gonçalo Fixture');

INSERT INTO events (
  id, manage_token_hash, title, host_name, host_email, starts_at, ends_at,
  status, host_id, location_type, location_name
) VALUES
  ('cccccccc-0000-4000-8000-000000000001', 'fixture-hash-1', 'Casamento Fixture',
   'Ana Fixture', 'fixture-anfitria@exemplo.pt', now() + interval '30 days', NULL,
   'scheduled', 'dddddddd-0000-4000-8000-000000000001', 'venue', 'Quinta Fixture'),
  ('cccccccc-0000-4000-8000-000000000002', 'fixture-hash-2', 'Aniversário Fixture',
   'Bruno Fixture', 'fixture-anfitriao-b@exemplo.pt', now() + interval '10 days', NULL,
   'scheduled', 'dddddddd-0000-4000-8000-000000000002', 'venue', 'Salão Fixture'),
  ('cccccccc-0000-4000-8000-000000000003', 'fixture-hash-3', 'Evento Legado Fixture',
   'Sem Conta', 'legado@exemplo.pt', now() + interval '5 days', NULL,
   'scheduled', NULL, 'venue', 'Espaço Fixture'),
  ('cccccccc-0000-4000-8000-000000000004', 'fixture-hash-4', 'Evento Sem Tarefas Fixture',
   'Ana Fixture', 'fixture-anfitria@exemplo.pt', now() + interval '60 days', NULL,
   'scheduled', 'dddddddd-0000-4000-8000-000000000001', 'venue', 'Quinta Fixture'),
  ('cccccccc-0000-4000-8000-000000000005', 'fixture-hash-5', 'Evento Sem Conta Mas Com Gestor',
   'Sem Conta', 'legado-com-gestor@exemplo.pt', now() + interval '15 days', NULL,
   'scheduled', NULL, 'venue', 'Espaço Fixture');

-- Convite anterior às migrações 16 e 17: serve para validar o backfill
-- da mensagem e da validade do link (evento sem `ends_at`).
INSERT INTO invitations (
  id, event_id, guest_name, guest_email, token_hash, token_encrypted
) VALUES
  ('99999999-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   'Convidado Legado', 'convidado-legado@exemplo.pt', 'legacy-invite-hash', 'x');

INSERT INTO event_managers (id, event_id, email, revoked_at) VALUES
  ('bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   'fixture-gestor@exemplo.pt', NULL),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000001',
   'fixture-revogado@exemplo.pt', now() - interval '2 days'),
  -- Evento sem tarefas antigas: só é usado no teste de materialização.
  ('bbbbbbbb-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000004',
   'fixture-gestor-e4@exemplo.pt', NULL),
  -- Evento sem anfitrião, mas com gestor activo: a "Geral" é criada e
  -- o gestor assume as tarefas.
  ('bbbbbbbb-0000-4000-8000-000000000004', 'cccccccc-0000-4000-8000-000000000005',
   'fixture-gestor-sem-anfitriao@exemplo.pt', NULL);

INSERT INTO host_tasks (id, host_id, event_id, manager_id, label, done, completed_at) VALUES
  -- Atribuída a gestor activo e já concluída.
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'Confirmar menu com o catering', true, now()),
  -- Atribuída a gestor revogado.
  ('aaaaaaaa-0000-4000-8000-000000000002',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000002', 'Fechar contrato da música', false, NULL),
  -- Sem responsável antigo: o anfitrião assume.
  ('aaaaaaaa-0000-4000-8000-000000000003',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   NULL, 'Escolher decoração da mesa', false, NULL),
  -- Outro evento, sem responsável.
  ('aaaaaaaa-0000-4000-8000-000000000004',
   'dddddddd-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000002',
   NULL, 'Encomendar bolo', true, now()),
  -- Tarefa pessoal, sem evento: fica em "Pessoais (legado)".
  ('aaaaaaaa-0000-4000-8000-000000000005',
   'dddddddd-0000-4000-8000-000000000001', NULL,
   NULL, 'Ligar à avó', false, NULL),
  -- Evento legado sem conta de anfitrião.
  ('aaaaaaaa-0000-4000-8000-000000000006',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003',
   NULL, 'Reservar espaço', false, NULL),
  -- Nome com exatamente 80 caracteres.
  ('aaaaaaaa-0000-4000-8000-000000000007',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
   NULL, 'Tarefa de limite ' || repeat('x', 63), false, NULL),
  -- Evento sem anfitrião: o gestor activo assume a tarefa.
  ('aaaaaaaa-0000-4000-8000-000000000008',
   'dddddddd-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000005',
   NULL, 'Preparar receção do evento legado', false, NULL);

COMMIT;

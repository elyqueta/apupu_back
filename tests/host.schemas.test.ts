import { describe, expect, it } from 'vitest';
import {
  avatarSchema,
  coverSchema,
  createTaskSchema,
  eventPeriodReportQuerySchema,
  eventReportQuerySchema,
  guestInvitationsQuerySchema,
  hostEventsQuerySchema,
  hostGuestsQuerySchema,
  updateProfileSchema,
  updateTaskSchema,
} from '../src/schemas/host.schemas';

describe('schema do perfil', () => {
  it('aceita data de nascimento de um adulto', () => {
    const parsed = updateProfileSchema.parse({ birth_date: '1990-05-17' });
    expect(parsed.birth_date).toBe('1990-05-17');
  });

  it('aceita limpar campos opcionais com null', () => {
    const parsed = updateProfileSchema.parse({
      display_name: null,
      phone: null,
      birth_date: null,
    });

    expect(parsed.display_name).toBeNull();
    expect(parsed.phone).toBeNull();
    expect(parsed.birth_date).toBeNull();
  });

  it('rejeita data de calendário inválida', () => {
    expect(updateProfileSchema.safeParse({ birth_date: '2026-02-30' }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ birth_date: '17/05/1990' }).success).toBe(false);
  });

  it('rejeita data de nascimento que implique menos de 18 anos', () => {
    const nextYear = new Date();
    nextYear.setUTCFullYear(nextYear.getUTCFullYear() + 1);
    const future = nextYear.toISOString().slice(0, 10);

    expect(updateProfileSchema.safeParse({ birth_date: future }).success).toBe(false);
  });

  it('rejeita um PATCH sem campos e campos desconhecidos', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ is_admin: true }).success).toBe(false);
  });

  it('exige um URL válido no avatar', () => {
    expect(avatarSchema.safeParse({ avatar_url: 'https://cdn.exemplo.ao/a.png' }).success).toBe(
      true
    );
    expect(avatarSchema.safeParse({ avatar_url: 'não-é-url' }).success).toBe(false);
    expect(avatarSchema.safeParse({}).success).toBe(false);
  });

  it('exige um URL válido na capa do perfil', () => {
    expect(coverSchema.safeParse({ cover_url: 'https://cdn.exemplo.ao/c.png' }).success).toBe(
      true
    );
    expect(coverSchema.safeParse({ cover_url: 'não-é-url' }).success).toBe(false);
    expect(coverSchema.safeParse({}).success).toBe(false);
    expect(updateProfileSchema.safeParse({ cover_url: null }).success).toBe(true);
  });
});

describe('schemas de listas do workspace', () => {
  it('aplica defaults de ordenação e paginação aos eventos', () => {
    expect(hostEventsQuerySchema.parse({})).toEqual({
      sort: 'starts_at',
      order: 'desc',
      page: 1,
      page_size: 20,
    });
  });

  it('converte paginação em string e rejeita valores fora dos limites', () => {
    const parsed = hostEventsQuerySchema.parse({ page: '2', page_size: '10' });
    expect(parsed.page).toBe(2);
    expect(parsed.page_size).toBe(10);

    expect(hostEventsQuerySchema.safeParse({ page_size: '101' }).success).toBe(false);
    expect(hostEventsQuerySchema.safeParse({ status: 'inexistente' }).success).toBe(false);
    expect(hostEventsQuerySchema.safeParse({ sort: 'title' }).success).toBe(false);
  });

  it('valida filtros de convidados', () => {
    const parsed = hostGuestsQuerySchema.parse({
      event_id: '2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec',
      rsvp_status: 'accepted',
      send_status: 'sent',
    });

    expect(parsed.rsvp_status).toBe('accepted');
    expect(hostGuestsQuerySchema.safeParse({ event_id: 'não-uuid' }).success).toBe(false);
    expect(hostGuestsQuerySchema.safeParse({ rsvp_status: 'talvez' }).success).toBe(false);
  });

  it('limita a janela do relatório diário', () => {
    expect(eventReportQuerySchema.parse({})).toEqual({ days: 30 });
    expect(eventReportQuerySchema.parse({ days: '7' })).toEqual({ days: 7 });
    expect(eventReportQuerySchema.safeParse({ days: 0 }).success).toBe(false);
    expect(eventReportQuerySchema.safeParse({ days: 366 }).success).toBe(false);
  });

  it('valida o período do relatório de um evento', () => {
    expect(
      eventPeriodReportQuerySchema.parse({
        from: '2026-11-01',
        to: '2026-11-30',
      })
    ).toEqual({ format: 'pdf', from: '2026-11-01', to: '2026-11-30' });

    expect(
      eventPeriodReportQuerySchema.safeParse({
        format: 'csv',
        from: '2026-11-01',
        to: '2026-11-30',
      }).success
    ).toBe(true);

    expect(
      eventPeriodReportQuerySchema.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success
    ).toBe(false);
    expect(
      eventPeriodReportQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success
    ).toBe(false);
    expect(
      eventPeriodReportQuerySchema.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success
    ).toBe(false);
  });

  it('aplica a ordenação ascendente de "Meus convites"', () => {
    expect(guestInvitationsQuerySchema.parse({})).toEqual({
      sort: 'starts_at',
      order: 'asc',
      page: 1,
      page_size: 20,
    });
    expect(
      guestInvitationsQuerySchema.parse({ sort: 'starts_at', order: 'desc', page: '2' })
    ).toEqual({
      sort: 'starts_at',
      order: 'desc',
      page: 2,
      page_size: 20,
    });

    expect(guestInvitationsQuerySchema.safeParse({ sort: 'title' }).success).toBe(false);
    expect(guestInvitationsQuerySchema.safeParse({ order: 'sideways' }).success).toBe(false);
    expect(guestInvitationsQuerySchema.safeParse({ page_size: '101' }).success).toBe(false);
  });
});

describe('schemas de tarefas', () => {
  it('aceita tarefa global e tarefa ligada a evento', () => {
    expect(createTaskSchema.parse({ label: '  Confirmar buffet  ' }).label).toBe(
      'Confirmar buffet'
    );
    expect(
      createTaskSchema.safeParse({
        label: 'Confirmar buffet',
        event_id: '2bbc2ed1-4b27-48f7-80f2-d3b05ca37cec',
      }).success
    ).toBe(true);
    expect(createTaskSchema.safeParse({ label: 'X', event_id: null }).success).toBe(true);
  });

  it('rejeita descrição vazia e campos desconhecidos', () => {
    expect(createTaskSchema.safeParse({ label: '   ' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ label: 'X', campo_desconhecido: true }).success).toBe(
      false
    );
  });

  it('aceita os aliases legados e rejeita estado contraditório', () => {
    expect(createTaskSchema.safeParse({ label: 'X', done: true }).success).toBe(true);
    expect(createTaskSchema.safeParse({ label: 'X', status: 'concluida' }).success).toBe(true);
    expect(
      createTaskSchema.safeParse({ label: 'X', status: 'concluida', done: false }).success
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ label: 'X', status: 'por_fazer', done: true }).success
    ).toBe(false);
  });

  it('exige pelo menos um campo na actualização', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
    expect(updateTaskSchema.safeParse({ done: true }).success).toBe(true);
    expect(updateTaskSchema.safeParse({ label: 'Novo' }).success).toBe(true);
  });
});

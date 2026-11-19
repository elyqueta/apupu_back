import { z } from 'zod';
import { isValidCalendarDate } from '../utils/date.util';
import { paginationQueryFields } from '../utils/pagination.util';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  TEAM_CATEGORIES,
  TEAM_MEMBER_ROLES,
  TEAM_MEMBER_STATUSES,
} from '../types/team.types';

/**
 * Contrato das equipas, membros e acções de tarefa.
 *
 * Todos os limites coincidem com as constraints da base de dados para
 * que um pedido inválido devolva 422 com uma mensagem em pt-PT, em vez
 * de um erro 500 vindo do Postgres.
 */

const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1')
  .optional();

const teamNameSchema = z
  .string()
  .trim()
  .min(1, 'Indique o nome da equipa.')
  .max(80, 'O nome da equipa não pode exceder 80 caracteres.');

const teamDescriptionSchema = z
  .string()
  .trim()
  .max(500, 'A descrição não pode exceder 500 caracteres.')
  .nullable()
  .optional();

export const teamListQuerySchema = z.object({
  event_id: z.uuid('Identificador de evento inválido.').optional(),
  category: z.enum(TEAM_CATEGORIES).optional(),
  q: z.string().trim().max(150).optional(),
  ...paginationQueryFields,
});

export const teamIdParamsSchema = z.object({
  teamId: z.uuid('Identificador de equipa inválido.'),
});

export const createTeamSchema = z
  .object({
    event_id: z.uuid('Identificador de evento inválido.'),
    name: teamNameSchema,
    category: z.enum(TEAM_CATEGORIES).default('outra'),
    description: teamDescriptionSchema,
  })
  .strict();

export const updateTeamSchema = z
  .object({
    name: teamNameSchema.optional(),
    category: z.enum(TEAM_CATEGORIES).optional(),
    description: teamDescriptionSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Indique pelo menos um campo para atualizar.',
  });

export const deleteTeamQuerySchema = z.object({
  confirm: booleanQuery,
  reassign_to_team_id: z.uuid('Identificador de equipa inválido.').optional(),
  archive: booleanQuery,
});

export const teamMemberListQuerySchema = z.object({
  role: z.enum(TEAM_MEMBER_ROLES).optional(),
  status: z.enum(TEAM_MEMBER_STATUSES).optional(),
  q: z.string().trim().max(150).optional(),
  ...paginationQueryFields,
});

export const teamMemberParamsSchema = z.object({
  teamId: z.uuid('Identificador de equipa inválido.'),
  memberId: z.uuid('Identificador de membro inválido.'),
});

export const teamInviteTokenParamsSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, 'Token de convite inválido.')
    .max(200, 'Token de convite inválido.'),
});

export const addTeamMembersSchema = z
  .object({
    emails: z
      .array(z.email('Email inválido.').max(320), {
        error: 'Indique a lista de emails a adicionar.',
      })
      .min(1, 'Indique pelo menos um email.'),
  })
  .strict();

export const updateTeamMemberRoleSchema = z
  .object({
    role: z.enum(TEAM_MEMBER_ROLES),
  })
  .strict();

export const removeTeamMemberQuerySchema = z.object({
  reassign_to_member_id: z.uuid('Identificador de membro inválido.').optional(),
});

export const taskAssigneeSchema = z
  .object({
    assignee_member_id: z.uuid('Identificador de membro inválido.'),
  })
  .strict();

export const taskStatusBodySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.status !== undefined || value.done !== undefined, {
    message: 'Indique o estado da tarefa.',
  })
  .refine(
    (value) =>
      value.status === undefined ||
      value.done === undefined ||
      value.done === (value.status === 'concluida'),
    {
      message: 'O estado e `done` não podem estar em contradição.',
      path: ['done'],
    }
  );

export const moveTaskSchema = z
  .object({
    team_id: z.uuid('Identificador de equipa inválido.'),
    assignee_member_id: z.uuid('Identificador de membro inválido.').optional(),
  })
  .strict();

export const taskDueDateSchema = z
  .string()
  .trim()
  .refine(isValidCalendarDate, 'Indique uma data válida no formato AAAA-MM-DD.')
  .nullable()
  .optional();

export const taskPrioritySchema = z.enum(TASK_PRIORITIES);
export const taskStatusSchema = z.enum(TASK_STATUSES);

export type TeamListQuery = z.infer<typeof teamListQuerySchema>;
export type CreateTeamBody = z.infer<typeof createTeamSchema>;
export type UpdateTeamBody = z.infer<typeof updateTeamSchema>;
export type DeleteTeamQuery = z.infer<typeof deleteTeamQuerySchema>;
export type TeamMemberListQuery = z.infer<typeof teamMemberListQuerySchema>;
export type AddTeamMembersBody = z.infer<typeof addTeamMembersSchema>;
export type UpdateTeamMemberRoleBody = z.infer<typeof updateTeamMemberRoleSchema>;
export type RemoveTeamMemberQuery = z.infer<typeof removeTeamMemberQuerySchema>;
export type TaskAssigneeBody = z.infer<typeof taskAssigneeSchema>;
export type TaskStatusBody = z.infer<typeof taskStatusBodySchema>;
export type MoveTaskBody = z.infer<typeof moveTaskSchema>;
export type TeamInviteTokenParams = z.infer<typeof teamInviteTokenParamsSchema>;

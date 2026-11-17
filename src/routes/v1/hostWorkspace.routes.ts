import { Router } from 'express';
import { activityController } from '../../controllers/activity.controller';
import { eventManagerController } from '../../controllers/eventManager.controller';
import { guestInvitationController } from '../../controllers/guestInvitation.controller';
import { hostEventController } from '../../controllers/hostEvent.controller';
import { hostGuestController } from '../../controllers/hostGuest.controller';
import { profileController } from '../../controllers/profile.controller';
import { reportController } from '../../controllers/report.controller';
import { taskController } from '../../controllers/task.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { writeLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import {
  requireVerifiedEmail,
  requireVerifiedGuestEmail,
} from '../../middlewares/requireVerifiedEmail';
import { uploadAvatar } from '../../middlewares/uploadAvatar';
import { validate } from '../../middlewares/validate';
import { createEventSchema, eventIdParamsSchema } from '../../schemas/event.schemas';
import {
  addEventManagerSchema,
  avatarSchema,
  createTaskSchema,
  eventManagerParamsSchema,
  eventReportQuerySchema,
  guestInvitationsQuerySchema,
  hostEventsQuerySchema,
  hostGuestsQuerySchema,
  paginatedQuerySchema,
  taskIdParamsSchema,
  tasksQuerySchema,
  updateProfileSchema,
  updateTaskSchema,
} from '../../schemas/host.schemas';

/**
 * Workspace da conta autenticada.
 *
 * Todas as rotas exigem `apupu_auth`; as mutações exigem também
 * `X-CSRF-Token`. O `host_id` vem sempre da sessão.
 */
const router = Router();

/**
 * @openapi
 * /api/v1/host/profile:
 *   get:
 *     tags: [Perfil]
 *     summary: Devolve o perfil completo da conta
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Conta e perfil.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *   patch:
 *     tags: [Perfil]
 *     summary: Actualiza campos do perfil
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateProfile' }
 *     responses:
 *       200:
 *         description: Perfil actualizado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 *       422:
 *         description: Data de nascimento ou outro campo inválido.
 */
router.get('/profile', asyncHandler(hostAccountAuth), asyncHandler(profileController.get));

router.patch(
  '/profile',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: updateProfileSchema }),
  asyncHandler(profileController.update)
);

/**
 * @openapi
 * /api/v1/host/profile/avatar:
 *   post:
 *     tags: [Perfil]
 *     summary: Define o URL do avatar da conta
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [avatar_url]
 *             properties:
 *               avatar_url: { type: string, format: uri }
 *     responses:
 *       200:
 *         description: Avatar actualizado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 */
router.post(
  '/profile/avatar',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: avatarSchema }),
  asyncHandler(profileController.setAvatar)
);

/**
 * @openapi
 * /api/v1/host/profile/avatar/upload:
 *   post:
 *     tags: [Perfil]
 *     summary: Envia uma imagem e define-a como avatar (Cloudinary)
 *     description: >
 *       Recebe `multipart/form-data` no campo `avatar` (JPEG, PNG ou
 *       WebP, até `AVATAR_MAX_BYTES`). O backend assina o upload para o
 *       Cloudinary e guarda o URL seguro no perfil; o segredo da API
 *       nunca é exposto ao cliente. Sem credenciais Cloudinary
 *       configuradas responde `503 avatar_upload_unavailable`; nesse
 *       caso continua a ser possível definir o avatar por URL em
 *       `POST /api/v1/host/profile/avatar`.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [avatar]
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar actualizado com o URL do Cloudinary.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 */
router.post(
  '/profile/avatar/upload',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  uploadAvatar,
  asyncHandler(profileController.uploadAvatar)
);

/**
 * @openapi
 * /api/v1/host/events:
 *   get:
 *     tags: [Workspace]
 *     summary: Lista paginada dos eventos da conta
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [draft, scheduled, cancelled, completed] }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [starts_at, created_at] }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Eventos com estatísticas e metadados de paginação.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventList' }
 *   post:
 *     tags: [Workspace]
 *     summary: Cria um evento associado à conta
 *     description: Exige email verificado. O link de gestão continua a ser enviado.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateEvent' }
 *     responses:
 *       201:
 *         description: Evento criado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventCreateEnvelope' }
 *       403:
 *         description: Email por verificar.
 */
router.get(
  '/events',
  asyncHandler(hostAccountAuth),
  validate({ query: hostEventsQuerySchema }),
  asyncHandler(hostEventController.list)
);

router.post(
  '/events',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  validate({ body: createEventSchema }),
  asyncHandler(hostEventController.create)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}:
 *   delete:
 *     tags: [Workspace]
 *     summary: Apaga um evento e os dados associados (cascata)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Evento apagado.
 *       404:
 *         description: Evento não encontrado.
 */
router.delete(
  '/events/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  asyncHandler(hostEventController.remove)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/manage-link/resend:
 *   post:
 *     tags: [Workspace]
 *     summary: Emite e reenvia um novo link de gestão
 *     description: >
 *       Gera um token novo, substitui o anterior e envia-o por email
 *       para `host_email`. O link anterior deixa imediatamente de ser
 *       válido. O token nunca é devolvido em JSON.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: Novo link emitido e entrega tentada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ManageLinkResendEnvelope' }
 *       403:
 *         description: Email por verificar.
 *       404:
 *         description: Evento não encontrado ou de outra conta.
 *       429:
 *         description: Demasiados pedidos.
 */
router.post(
  '/events/:eventId/manage-link/resend',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  asyncHandler(hostEventController.resendManageLink)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/managers:
 *   get:
 *     tags: [Gestores]
 *     summary: Lista os gestores activos do evento
 *     description: >
 *       Apenas o anfitrião (proprietário) pode gerir gestores. Cada
 *       gestor é identificado pelo email e pode não ter conta; nesse
 *       caso usa o link enviado por email.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Gestores activos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventManagerList' }
 *       404:
 *         description: Evento não encontrado ou de outra conta.
 *   post:
 *     tags: [Gestores]
 *     summary: Adiciona um gestor e envia-lhe o link de gestão
 *     description: >
 *       O gestor não precisa de conta. Recebe um link próprio por
 *       email; se já tiver uma conta verificada com o mesmo email,
 *       passa também a ver o evento no workspace.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AddEventManager' }
 *     responses:
 *       201:
 *         description: Gestor adicionado e convite enfileirado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventManagerEnvelope' }
 *       409:
 *         description: O email já é gestor do evento.
 *       422:
 *         description: Email inválido ou igual ao do anfitrião.
 */
router.get(
  '/events/:eventId/managers',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(eventManagerController.list)
);

router.post(
  '/events/:eventId/managers',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  validate({ body: addEventManagerSchema }),
  asyncHandler(eventManagerController.add)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/managers/{managerId}:
 *   delete:
 *     tags: [Gestores]
 *     summary: Remove o acesso de um gestor
 *     description: >
 *       A remoção é lógica: o link deixa de funcionar e as sessões
 *       abertas pelo gestor são revogadas. O mesmo email pode voltar a
 *       ser adicionado mais tarde.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: managerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Gestor removido.
 *       404:
 *         description: Evento ou gestor não encontrado.
 *
 * /api/v1/host/events/{eventId}/managers/{managerId}/resend:
 *   post:
 *     tags: [Gestores]
 *     summary: Reenvia o link de gestão a um gestor
 *     description: >
 *       Emite um link novo, substitui o anterior e enfileira o email.
 *       O token nunca é devolvido em JSON.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: managerId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: Link emitido e entrega enfileirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventManagerEnvelope' }
 *       404:
 *         description: Evento ou gestor não encontrado.
 */
router.delete(
  '/events/:eventId/managers/:managerId',
  validate({ params: eventManagerParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  asyncHandler(eventManagerController.remove)
);

router.post(
  '/events/:eventId/managers/:managerId/resend',
  validate({ params: eventManagerParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  asyncHandler(eventManagerController.resend)
);

/**
 * @openapi
 * /api/v1/host/dashboard:
 *   get:
 *     tags: [Workspace]
 *     summary: Resumo para o painel (próximo evento, próximos e totais)
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Dados do painel.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DashboardEnvelope' }
 */
router.get('/dashboard', asyncHandler(hostAccountAuth), asyncHandler(hostEventController.dashboard));

/**
 * @openapi
 * /api/v1/host/guests:
 *   get:
 *     tags: [Workspace]
 *     summary: Lista paginada de convidados de todos os eventos da conta
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: event_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: rsvp_status
 *         schema: { type: string, enum: [pending, accepted, declined] }
 *       - in: query
 *         name: send_status
 *         schema: { type: string, enum: [pending, queued, sent, failed] }
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Convidados com resumo do evento e paginação.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostGuestList' }
 */
router.get(
  '/guests',
  asyncHandler(hostAccountAuth),
  validate({ query: hostGuestsQuerySchema }),
  asyncHandler(hostGuestController.list)
);

/**
 * @openapi
 * /api/v1/host/invitations:
 *   get:
 *     tags: [Convidados]
 *     summary: Lista os convites dirigidos ao email da conta autenticada
 *     description: >
 *       "Meus convites": eventos em que a conta autenticada foi
 *       convidada. A associação é feita por
 *       `invitations.guest_email` = email da conta, comparado sem
 *       distinguir maiúsculas/minúsculas (opção A). Exige email
 *       verificado; uma conta por verificar recebe `403
 *       email_not_verified`. Convites revogados não aparecem.
 *
 *       Cada item inclui apenas o próprio convite e um resumo público
 *       do evento (título, anfitrião, data, fuso, estado, categoria,
 *       template e local). Nunca expõe outros convidados, contagens,
 *       contribuições/banca ou notas privadas do evento.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [starts_at], default: starts_at }
 *       - in: query
 *         name: order
 *         schema: { type: string, enum: [asc, desc], default: asc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: >
 *           Convites da conta, ordenados por `starts_at` ascendente
 *           (eventos sem data ficam no fim). Lista vazia devolve
 *           `data: []` e paginação a zeros.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GuestInvitationList' }
 *       401:
 *         description: Sessão ausente ou expirada (`host_session_invalid`).
 *       403:
 *         description: Email da conta por verificar (`email_not_verified`).
 *       422:
 *         description: Parâmetros de paginação/ordenação inválidos.
 */
router.get(
  '/invitations',
  asyncHandler(hostAccountAuth),
  requireVerifiedGuestEmail,
  validate({ query: guestInvitationsQuerySchema }),
  asyncHandler(guestInvitationController.listMine)
);

/**
 * @openapi
 * /api/v1/host/activity:
 *   get:
 *     tags: [Workspace]
 *     summary: Feed de actividade de todos os eventos da conta
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Actividade paginada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ActivityList' }
 */
router.get(
  '/activity',
  asyncHandler(hostAccountAuth),
  validate({ query: paginatedQuerySchema }),
  asyncHandler(activityController.list)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/activity:
 *   get:
 *     tags: [Workspace]
 *     summary: Feed de actividade de um evento
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Actividade paginada do evento.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventActivityList' }
 *       404:
 *         description: Evento não encontrado.
 */
router.get(
  '/events/:eventId/activity',
  validate({ params: eventIdParamsSchema, query: paginatedQuerySchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(activityController.listForEvent)
);

/**
 * @openapi
 * /api/v1/host/reports/summary:
 *   get:
 *     tags: [Workspace]
 *     summary: Agregados globais da conta (por evento e taxas)
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Resumo de relatórios.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ReportSummaryEnvelope' }
 */
router.get(
  '/reports/summary',
  asyncHandler(hostAccountAuth),
  asyncHandler(reportController.summary)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/reports:
 *   get:
 *     tags: [Workspace]
 *     summary: Série diária de um evento
 *     description: Janela em dias (UTC), um ponto por dia, incluindo dias sem movimento.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: days
 *         schema: { type: integer, minimum: 1, maximum: 365, default: 30 }
 *     responses:
 *       200:
 *         description: Série diária.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/DailyReportEnvelope' }
 *       404:
 *         description: Evento não encontrado.
 */
router.get(
  '/events/:eventId/reports',
  validate({ params: eventIdParamsSchema, query: eventReportQuerySchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(reportController.eventDaily)
);

/**
 * @openapi
 * /api/v1/host/tasks:
 *   get:
 *     tags: [Workspace]
 *     summary: Lista tarefas da conta (globais e/ou de um evento)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: event_id
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tarefas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TaskList' }
 *   post:
 *     tags: [Workspace]
 *     summary: Cria uma tarefa
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label]
 *             properties:
 *               label: { type: string }
 *               event_id: { type: string, format: uuid, nullable: true }
 *     responses:
 *       201:
 *         description: Tarefa criada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TaskEnvelope' }
 */
router.get(
  '/tasks',
  asyncHandler(hostAccountAuth),
  validate({ query: tasksQuerySchema }),
  asyncHandler(taskController.list)
);

router.post(
  '/tasks',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: createTaskSchema }),
  asyncHandler(taskController.create)
);

/**
 * @openapi
 * /api/v1/host/tasks/{taskId}:
 *   patch:
 *     tags: [Workspace]
 *     summary: Actualiza a descrição ou o estado de uma tarefa
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Tarefa actualizada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TaskEnvelope' }
 *       404:
 *         description: Tarefa não encontrada.
 *   delete:
 *     tags: [Workspace]
 *     summary: Remove uma tarefa
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: taskId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Tarefa removida.
 */
router.patch(
  '/tasks/:taskId',
  validate({ params: taskIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: updateTaskSchema }),
  asyncHandler(taskController.update)
);

router.delete(
  '/tasks/:taskId',
  validate({ params: taskIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(taskController.remove)
);

export default router;

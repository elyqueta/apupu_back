import { Router } from 'express';
import { activityController } from '../../controllers/activity.controller';
import { hostEventController } from '../../controllers/hostEvent.controller';
import { hostGuestController } from '../../controllers/hostGuest.controller';
import { profileController } from '../../controllers/profile.controller';
import { reportController } from '../../controllers/report.controller';
import { taskController } from '../../controllers/task.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { writeLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import { requireVerifiedEmail } from '../../middlewares/requireVerifiedEmail';
import { uploadAvatar } from '../../middlewares/uploadAvatar';
import { validate } from '../../middlewares/validate';
import { createEventSchema, eventIdParamsSchema } from '../../schemas/event.schemas';
import {
  avatarSchema,
  createTaskSchema,
  eventReportQuerySchema,
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

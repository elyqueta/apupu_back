import { Router } from 'express';
import { activityController } from '../../controllers/activity.controller';
import { authController } from '../../controllers/auth.controller';
import { eventManagerController } from '../../controllers/eventManager.controller';
import { guestInvitationController } from '../../controllers/guestInvitation.controller';
import { inboxController } from '../../controllers/inbox.controller';
import { hostEventController } from '../../controllers/hostEvent.controller';
import { hostGuestController } from '../../controllers/hostGuest.controller';
import { notificationController } from '../../controllers/notification.controller';
import { profileController } from '../../controllers/profile.controller';
import { reportController } from '../../controllers/report.controller';
import { taskController } from '../../controllers/task.controller';
import { teamController } from '../../controllers/team.controller';
import { teamMemberController } from '../../controllers/teamMember.controller';
import { teamInviteController } from '../../controllers/teamInvite.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAccountAuth } from '../../middlewares/hostAccountAuth';
import { hostAuth } from '../../middlewares/hostAuth';
import { managerSessionAuth } from '../../middlewares/managerSessionAuth';
import { writeLimiter } from '../../middlewares/rateLimiter';
import { requireAuthCsrf } from '../../middlewares/requireAuthCsrf';
import {
  requireVerifiedEmail,
  requireVerifiedGuestEmail,
} from '../../middlewares/requireVerifiedEmail';
import { uploadAvatar } from '../../middlewares/uploadAvatar';
import { uploadProfileCover } from '../../middlewares/uploadProfileCover';
import { uploadTeamPhoto } from '../../middlewares/uploadTeamPhoto';
import { validate } from '../../middlewares/validate';
import { registerRequestCodeSchema } from '../../schemas/auth.schemas';
import { hostCancelSchema } from '../../schemas/admin.schemas';
import {
  createEventSchema,
  deleteEventSchema,
  eventIdParamsSchema,
} from '../../schemas/event.schemas';
import {
  addEventManagerSchema,
  avatarSchema,
  coverSchema,
  createTaskSchema,
  eventManagerParamsSchema,
  eventReportQuerySchema,
  eventExportParamsSchema,
  eventExportQuerySchema,
  eventPeriodReportQuerySchema,
  guestInvitationsQuerySchema,
  hostEventsQuerySchema,
  hostGuestsQuerySchema,
  notificationIdParamsSchema,
  notificationsQuerySchema,
  paginatedQuerySchema,
  regenerateManagerAccessSchema,
  reportExportQuerySchema,
  taskIdParamsSchema,
  tasksQuerySchema,
  updateManagerLinkSchema,
  updateNotificationSchema,
  updateProfileSchema,
  updateTaskSchema,
} from '../../schemas/host.schemas';
import {
  inboxAnswerSchema,
  inboxIdParamsSchema,
  inboxQuerySchema,
  inboxReadSchema,
} from '../../schemas/inbox.schemas';
import {
  addTeamMembersSchema,
  createTeamSchema,
  setTeamEventsSchema,
  teamEventParamsSchema,
  deleteTeamQuerySchema,
  moveTaskSchema,
  removeTeamMemberQuerySchema,
  taskAssigneeSchema,
  taskStatusBodySchema,
  teamIdParamsSchema,
  teamListQuerySchema,
  teamMemberListQuerySchema,
  teamMemberParamsSchema,
  updateTeamMemberRoleSchema,
  updateTeamSchema,
} from '../../schemas/team.schemas';

/**
 * Workspace da conta autenticada.
 *
 * Todas as rotas exigem `apupu_auth`; as mutações exigem também
 * `X-CSRF-Token`. O `host_id` vem sempre da sessão.
 */
const router = Router();

/**
 * @openapi
 * /api/v1/host/manager/register/request-code:
 *   post:
 *     tags: [Conta]
 *     summary: Prepara o registo de um gestor autenticado por link + código
 *     description: >
 *       Exige a sessão de gestão (cookie HttpOnly) e o CSRF derivado.
 *       Quando o email pedido é o mesmo do gestor, o OTP é dispensado;
 *       caso contrário segue o fluxo normal por email.
 *     security:
 *       - hostSession: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Contacto já verificado; token de registo devolvido.
 *       202:
 *         description: OTP enviado por email.
 *       401:
 *         description: Sem sessão de gestão válida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Dados inválidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/manager/register/request-code',
  writeLimiter,
  asyncHandler(managerSessionAuth),
  validate({ body: registerRequestCodeSchema }),
  asyncHandler(authController.requestManagerRegistrationCode)
);

/**
 * @openapi
 * /api/v1/host/manager/access-code:
 *   post:
 *     tags: [Gestão]
 *     summary: Gestor troca o próprio código de acesso
 *     description: >
 *       Usa a sessão de gestão (sem conta). Devolve o novo código em
 *       claro uma única vez e revoga as sessões antigas do evento.
 *     security:
 *       - hostSession: []
 *     responses:
 *       200: { description: Novo link e código. }
 *       401:
 *         description: Sessão de gestão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/manager/access-code',
  writeLimiter,
  asyncHandler(managerSessionAuth),
  asyncHandler(eventManagerController.regenerateOwnAccess)
);

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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 * /api/v1/host/profile/avatar:
 *   delete:
 *     tags: [Perfil]
 *     summary: Remove o avatar da conta
 *     description: >
 *       Operação idempotente. Quando o avatar veio do Cloudinary, o
 *       asset é removido; falhas nessa remoção são registadas e não
 *       impedem a resposta.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Avatar removido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Token CSRF inválido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete(
  '/profile/avatar',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(profileController.removeAvatar)
);

/**
 * @openapi
 * /api/v1/host/profile/cover:
 *   post:
 *     tags: [Perfil]
 *     summary: Define o URL da imagem de capa do perfil
 *     description: Repetir o mesmo URL é idempotente.
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
 *             required: [cover_url]
 *             properties:
 *               cover_url: { type: string, format: uri }
 *     responses:
 *       200:
 *         description: Capa actualizada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 *   delete:
 *     tags: [Perfil]
 *     summary: Remove a imagem de capa do perfil
 *     description: Operação idempotente; devolve o perfil sem capa.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Perfil actualizado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 *
 * /api/v1/host/profile/cover/upload:
 *   post:
 *     tags: [Perfil]
 *     summary: Envia uma imagem e define-a como capa (Cloudinary)
 *     description: >
 *       Recebe `multipart/form-data` no campo `cover` (JPEG, PNG ou
 *       WebP, até `PROFILE_COVER_MAX_BYTES`). O upload é idempotente
 *       por conteúdo (SHA-256). Sem credenciais Cloudinary responde
 *       `503 profile_cover_upload_unavailable`; nesse caso continua a
 *       ser possível definir a capa por URL em
 *       `POST /api/v1/host/profile/cover`.
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
 *             required: [cover]
 *             properties:
 *               cover:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Capa actualizada com o URL do Cloudinary.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEnvelope' }
 *       503:
 *         description: Upload indisponível (`profile_cover_upload_unavailable`).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/profile/cover',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: coverSchema }),
  asyncHandler(profileController.setCover)
);

router.post(
  '/profile/cover/upload',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  uploadProfileCover,
  asyncHandler(profileController.uploadCover)
);

router.delete(
  '/profile/cover',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(profileController.removeCover)
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 *     summary: Remove um evento (remoção lógica)
 *     description: >
 *       Só o proprietário pode remover. Se houver convidados com presença
 *       confirmada, o corpo tem de trazer `confirm_name` igual ao título
 *       do evento (comparação exacta, após trim); caso contrário devolve
 *       422 `event_delete_confirmation_required`.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               confirm_name: { type: string }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Falta confirmar o nome do evento.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.delete(
  '/events/:eventId',
  validate({ params: eventIdParamsSchema, body: deleteEventSchema }),
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Evento não encontrado ou de outra conta.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Demasiados pedidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 * /api/v1/host/managers:
 *   get:
 *     tags: [Gestores]
 *     summary: Lista os gestores de todos os eventos da conta
 *     description: >
 *       Página global de equipas. Devolve apenas gestores activos de
 *       eventos cujo proprietário é a conta autenticada.
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Gestores activos com o evento a que pertencem.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostEventManagerList' }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/managers',
  asyncHandler(hostAccountAuth),
  asyncHandler(eventManagerController.listAll)
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   post:
 *     tags: [Gestores]
 *     summary: Adiciona um gestor e envia-lhe o link de gestão
 *     description: >
 *       O gestor não precisa de conta. Recebe um link próprio por
 *       email; se já tiver uma conta verificada com o mesmo email,
 *       passa também a ver o evento no workspace. Se ainda não existir
 *       convite para esse email, o gestor é automaticamente incluído
 *       na lista de convidados e recebe também o convite.
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
 *       404:
 *         description: Evento não encontrado ou de outra conta.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: O email já é gestor do evento.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Email inválido ou igual ao do anfitrião.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */

/**
 * @openapi
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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

router.patch(
  '/events/:eventId/managers/:managerId/link',
  validate({ params: eventManagerParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  validate({ body: updateManagerLinkSchema }),
  asyncHandler(eventManagerController.updateLink)
);

router.post(
  '/events/:eventId/managers/:managerId/access-code',
  validate({ params: eventManagerParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  validate({ body: regenerateManagerAccessSchema }),
  asyncHandler(eventManagerController.regenerateAccess)
);

router.post(
  '/events/:eventId/managers/:managerId/revoke',
  validate({ params: eventManagerParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  requireVerifiedEmail,
  asyncHandler(eventManagerController.revokeLink)
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
/**
 * @openapi
 * /api/v1/host/events/{eventId}/cancel/otp:
 *   post:
 *     tags: [Gestão]
 *     summary: Envia o OTP que autoriza o cancelamento do evento
 *     description: >
 *       O código vai apenas para o email da conta, cifrado na outbox.
 *       Nunca é devolvido na resposta. Válido por 10 minutos.
 *     security:
 *       - accountSession: []
 *     responses:
 *       200: { description: Código enviado. }
 *       429:
 *         description: Reenvio demasiado cedo.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *
 * /api/v1/host/events/{eventId}/cancel:
 *   post:
 *     tags: [Gestão]
 *     summary: Cancela o evento (motivo opcional, OTP obrigatório)
 *     security:
 *       - accountSession: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp]
 *             properties:
 *               otp: { type: string, pattern: '^[0-9]{6}$' }
 *               reason: { type: string, nullable: true }
 *     responses:
 *       200: { description: Evento cancelado. }
 *       409:
 *         description: Evento já cancelado (`event_cancelled`).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/events/:eventId/cancel/otp',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(hostEventController.requestCancelOtp)
);

router.post(
  '/events/:eventId/cancel',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: hostCancelSchema }),
  asyncHandler(hostEventController.cancel)
);

/**
 * @openapi
 * /api/v1/host/inbox:
 *   get:
 *     tags: [Convidados]
 *     summary: Mensagens deixadas pelos convidados nos eventos da conta
 *     description: >
 *       Filtros: `q`, `event_id`, `read=read|unread`,
 *       `answered=answered|unanswered`, `from`, `to` e paginação.
 *       Inclui eventos próprios e geridos
 *       (email verificado).
 *     security:
 *       - accountSession: []
 *     responses:
 *       200: { description: Lista paginada de mensagens. }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *
 * /api/v1/host/inbox/{invitationId}/read:
 *   post:
 *     tags: [Convidados]
 *     summary: Marca uma mensagem como lida ou não lida
 *     security:
 *       - accountSession: []
 *     responses:
 *       200: { description: Estado de leitura actualizado. }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Mensagem não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *
 * /api/v1/host/inbox/{invitationId}/answer:
 *   post:
 *     tags: [Convidados]
 *     summary: Responde a uma mensagem
 *     description: >
 *       A resposta fica guardada no convite, aparece no convite público
 *       e é enviada por e-mail ao convidado quando a fila estiver
 *       disponível.
 *     security:
 *       - accountSession: []
 *     responses:
 *       200: { description: Resposta guardada. }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Mensagem não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Resposta vazia ou demasiado longa.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/inbox',
  asyncHandler(hostAccountAuth),
  validate({ query: inboxQuerySchema }),
  asyncHandler(inboxController.list)
);

router.post(
  '/inbox/:invitationId/read',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: inboxIdParamsSchema }),
  validate({ body: inboxReadSchema }),
  asyncHandler(inboxController.setRead)
);

router.post(
  '/inbox/:invitationId/answer',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: inboxIdParamsSchema }),
  validate({ body: inboxAnswerSchema }),
  asyncHandler(inboxController.answer)
);

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
 *         name: for_team
 *         description: >
 *           Devolve os candidatos a membro da equipa indicada: apenas
 *           convidados de eventos em que a conta é anfitriã, mais os do
 *           evento dessa equipa, deduplicados por email. A resposta
 *           inclui `is_member` e `has_email`.
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: Email da conta por verificar (`email_not_verified`).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Parâmetros de paginação/ordenação inválidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 *       - hostSession: []
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/events/:eventId/activity',
  validate({ params: eventIdParamsSchema, query: paginatedQuerySchema }),
  asyncHandler(hostAuth),
  asyncHandler(activityController.listForEvent)
);

/**
 * @openapi
 * /api/v1/host/notifications:
 *   get:
 *     tags: [Notificações]
 *     summary: Lista paginada de notificações da conta
 *     description: >
 *       Inclui actividades, lembretes de eventos a aproximar-se, prazos
 *       de RSVP e tarefas. Filtros por estado, tipo, evento e pesquisa.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [all, unread, read], default: all }
 *       - in: query
 *         name: kind
 *         schema:
 *           type: string
 *           enum: [rsvp_accepted, rsvp_declined, guest_added, reminder_sent, event_created, event_upcoming, rsvp_deadline, task_assigned, task_completed, task_reassigned, team_added, role_changed]
 *       - in: query
 *         name: event_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: q
 *         schema: { type: string, maxLength: 150 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page_size
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Notificações paginadas e contagem de não lidas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/NotificationList' }
 *   delete:
 *     tags: [Notificações]
 *     summary: Limpa todas as notificações (remoção lógica)
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quantidade removida.
 *
 * /api/v1/host/notifications/unread-count:
 *   get:
 *     tags: [Notificações]
 *     summary: Contagem de notificações não lidas
 *     security:
 *       - accountSession: []
 *     responses:
 *       200:
 *         description: Contagem actual.
 *
 * /api/v1/host/notifications/read-all:
 *   post:
 *     tags: [Notificações]
 *     summary: Marca todas as notificações como lidas
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Quantidade actualizada.
 *
 * /api/v1/host/notifications/{notificationId}:
 *   patch:
 *     tags: [Notificações]
 *     summary: Marca uma notificação como lida ou não lida
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: notificationId
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
 *           schema:
 *             type: object
 *             required: [read]
 *             properties:
 *               read: { type: boolean }
 *     responses:
 *       200:
 *         description: Notificação actualizada.
 *       404:
 *         description: Notificação não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Notificações]
 *     summary: Remove uma notificação
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Notificação removida.
 */
router.get(
  '/notifications/unread-count',
  asyncHandler(hostAccountAuth),
  asyncHandler(notificationController.unreadCount)
);

router.post(
  '/notifications/read-all',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(notificationController.markAllRead)
);

router.get(
  '/notifications',
  asyncHandler(hostAccountAuth),
  validate({ query: notificationsQuerySchema }),
  asyncHandler(notificationController.list)
);

router.delete(
  '/notifications',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(notificationController.dismissAll)
);

router.patch(
  '/notifications/:notificationId',
  validate({ params: notificationIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: updateNotificationSchema }),
  asyncHandler(notificationController.setRead)
);

router.delete(
  '/notifications/:notificationId',
  validate({ params: notificationIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(notificationController.dismiss)
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
 * /api/v1/host/reports/export:
 *   get:
 *     tags: [Workspace]
 *     summary: Exporta o relatório agregado em PDF ou CSV
 *     description: >
 *       Documento gerado no servidor com a identidade visual do Conto
 *       Contigo. O PDF inclui a logo da plataforma e marca de água; o CSV
 *       inclui o mesmo resumo em formato tabular.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [pdf, csv], default: pdf }
 *     responses:
 *       200:
 *         description: Ficheiro do relatório.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *           text/csv:
 *             schema: { type: string }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Formato inválido (`validation_failed`).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/reports/export',
  asyncHandler(hostAccountAuth),
  validate({ query: reportExportQuerySchema }),
  asyncHandler(reportController.exportSummary)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/exports/{document}:
 *   get:
 *     tags: [Workspace]
 *     summary: Exporta um documento do evento em PDF ou CSV
 *     description: >
 *       `document` aceita `guests` (lista de convidados), `summary`
 *       (resumo do evento), `attendance` (presenças confirmadas) ou
 *       `ticket` (bilhete individual com QR, só PDF). O CSV usa UTF-8
 *       com BOM, separador `;` e CRLF; o PDF segue a identidade visual
 *       do Conto Contigo.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: document
 *         required: true
 *         schema:
 *           type: string
 *           enum: [guests, summary, attendance, ticket]
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [pdf, csv], default: pdf }
 *       - in: query
 *         name: invitation_id
 *         description: Obrigatório quando `document` é `ticket`.
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Ficheiro PDF ou CSV.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *           text/csv:
 *             schema: { type: string, format: binary }
 *       400:
 *         description: Parâmetros inválidos (por exemplo, bilhete em CSV).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Evento ou convite não encontrado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/events/:eventId/exports/:document',
  validate({ params: eventExportParamsSchema, query: eventExportQuerySchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(reportController.eventExport)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/reports/export:
 *   get:
 *     tags: [Workspace]
 *     summary: Exporta o relatório de um evento num período
 *     description: >
 *       Relatório de um único projeto. `from` e `to` são dias de
 *       calendário `YYYY-MM-DD` interpretados em UTC, inclusive. O
 *       documento mostra o movimento do período (convites criados,
 *       respostas recebidas e lembretes enviados) e, em separado, o
 *       estado atual do evento. Aceita no máximo 366 dias.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         required: true
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [pdf, csv], default: pdf }
 *     responses:
 *       200:
 *         description: Ficheiro PDF ou CSV.
 *         content:
 *           application/pdf:
 *             schema: { type: string, format: binary }
 *           text/csv:
 *             schema: { type: string, format: binary }
 *       401:
 *         description: Sessão inválida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Evento não encontrado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Datas inválidas, período invertido ou superior a 366 dias.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/events/:eventId/reports/export',
  validate({ params: eventIdParamsSchema, query: eventPeriodReportQuerySchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(reportController.eventPeriodExport)
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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
 *     description: >
 *       Com `team_id`, qualquer membro activo cria na equipa. Sem
 *       `team_id` mas com `event_id`, usa ou cria a equipa "Geral" do
 *       evento; o responsável por omissão é o anfitrião, salvo
 *       `manager_id`. Sem evento nem equipa, cria uma tarefa pessoal
 *       legada visível só ao criador. Criar já concluída
 *       (`status=concluida` ou `done=true`) só é permitido ao
 *       responsável (`403 task_complete_forbidden`).
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
 *             required: [title]
 *             properties:
 *               title: { type: string, maxLength: 200 }
 *               label: { type: string, maxLength: 200, deprecated: true }
 *               description: { type: string, maxLength: 2000, nullable: true }
 *               due_date: { type: string, format: date, nullable: true }
 *               priority:
 *                 { type: string, enum: [baixa, normal, alta], default: normal }
 *               status:
 *                 { type: string, enum: [por_fazer, em_curso, concluida], default: por_fazer }
 *               done: { type: boolean, deprecated: true }
 *               event_id: { type: string, format: uuid, nullable: true }
 *               team_id: { type: string, format: uuid, nullable: true }
 *               assignee_member_id: { type: string, format: uuid, nullable: true }
 *               manager_id: { type: string, format: uuid, nullable: true, deprecated: true }
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
 *     summary: Actualiza os campos ou o estado de uma tarefa
 *     description: >
 *       O anfitrião e os gestores editam qualquer tarefa do evento; um
 *       membro só as que criou (`403 task_edit_forbidden`). Qualquer
 *       mudança de `status`/`done` — concluir, reabrir ou `em_curso` —
 *       segue a mesma regra do endpoint `/status`: só o responsável, com
 *       `403 task_complete_forbidden` para as restantes contas.
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
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

/**
 * @openapi
 * /api/v1/host/tasks/{taskId}/status:
 *   patch:
 *     tags: [Workspace]
 *     summary: Conclui, reabre ou passa a tarefa a em curso
 *     description: >
 *       Só o responsável pode mudar o estado (concluir, reabrir ou
 *       `em_curso`); qualquer outra conta recebe
 *       `403 task_complete_forbidden` com a mensagem
 *       "Só {nome} pode concluir esta tarefa." (ou "...pode alterar o
 *       estado desta tarefa."). A conclusão é atómica: pedidos
 *       concorrentes não sobrescrevem `completed_at` nem geram
 *       notificações duplicadas.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [por_fazer, em_curso, concluida] }
 *               done: { type: boolean, deprecated: true }
 *     responses:
 *       200:
 *         description: Tarefa actualizada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TaskEnvelope' }
 *       403:
 *         description: A conta não é o responsável pela tarefa.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Tarefa não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.patch(
  '/tasks/:taskId/status',
  validate({ params: taskIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: taskStatusBodySchema }),
  asyncHandler(taskController.setStatus)
);

/**
 * @openapi
 * /api/v1/host/tasks/{taskId}/assignee:
 *   patch:
 *     tags: [Workspace]
 *     summary: Reatribui uma tarefa a outro membro da equipa
 *     description: Exclusivo do anfitrião e dos gestores.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignee_member_id]
 *             properties:
 *               assignee_member_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tarefa reatribuída.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TaskEnvelope' }
 *       403:
 *         description: A conta não pode reatribuir tarefas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Tarefa não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.patch(
  '/tasks/:taskId/assignee',
  validate({ params: taskIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: taskAssigneeSchema }),
  asyncHandler(taskController.reassign)
);

/**
 * @openapi
 * /api/v1/host/tasks/{taskId}/move:
 *   post:
 *     tags: [Workspace]
 *     summary: Move uma tarefa para outra equipa
 *     description: >
 *       Inclui "Mover para uma equipa" nas tarefas pessoais legadas
 *       (`team_id = null`). O responsável é mantido quando o mesmo
 *       email existe na equipa de destino.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [team_id]
 *             properties:
 *               team_id: { type: string, format: uuid }
 *               assignee_member_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Tarefa movida.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TaskEnvelope' }
 *       404:
 *         description: Tarefa ou equipa não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/tasks/:taskId/move',
  validate({ params: taskIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: moveTaskSchema }),
  asyncHandler(taskController.move)
);

/**
 * @openapi
 * /api/v1/host/teams:
 *   get:
 *     tags: [Equipas]
 *     summary: Lista equipas visíveis para a conta
 *     description: >
 *       O anfitrião e os gestores vêem todas as equipas do evento; um
 *       membro só as equipas em que está activo.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: query
 *         name: event_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [logistica, decoracao, musica, catering, rececao, outra]
 *       - in: query
 *         name: role
 *         description: Papel da conta na equipa.
 *         schema:
 *           type: string
 *           enum: [anfitriao, gestor, membro]
 *       - in: query
 *         name: event_status
 *         description: Estado observável do evento, derivado das datas.
 *         schema:
 *           type: string
 *           enum: [agendado, em_curso, concluido, cancelado, rascunho]
 *       - in: query
 *         name: mine
 *         description: >
 *           Só equipas em que fui adicionado como membro/gestor ou onde
 *           tenho tarefas por concluir atribuídas a mim. A presença
 *           implícita do anfitrião não conta.
 *         schema: { type: boolean }
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
 *         description: Equipas com contagens e paginação.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamList' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   post:
 *     tags: [Equipas]
 *     summary: Cria uma equipa no evento
 *     description: >
 *       Exclusivo do anfitrião e dos gestores. Materializa o anfitrião e
 *       os gestores activos como membros na mesma transação.
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
 *             required: [event_id, name]
 *             properties:
 *               event_id: { type: string, format: uuid }
 *               name: { type: string, maxLength: 80 }
 *               category:
 *                 type: string
 *                 enum: [logistica, decoracao, musica, catering, rececao, outra]
 *               description: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       201:
 *         description: Equipa criada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamEnvelope' }
 *       403:
 *         description: A conta não pode gerir equipas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       409:
 *         description: Já existe uma equipa com esse nome no evento.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/teams',
  asyncHandler(hostAccountAuth),
  validate({ query: teamListQuerySchema }),
  asyncHandler(teamController.list)
);

router.post(
  '/teams',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: createTeamSchema }),
  asyncHandler(teamController.create)
);

/**
 * @openapi
 * /api/v1/host/teams/{teamId}/events:
 *   put:
 *     tags: [Equipas]
 *     summary: Associa a equipa a eventos (só o criador)
 *     description: >
 *       Substitui os eventos geridos pela equipa (`event_ids` ou `all`). O
 *       evento principal mantém-se sempre. Só eventos que o criador gere.
 *     responses:
 *       200: { description: Equipa actualizada. }
 *       403:
 *         description: Não é o criador.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       422:
 *         description: Evento inválido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.put(
  '/teams/:teamId/events',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: teamIdParamsSchema, body: setTeamEventsSchema }),
  asyncHandler(teamController.setEvents)
);

router.delete(
  '/teams/:teamId/events/:eventId',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: teamEventParamsSchema }),
  asyncHandler(teamController.removeEvent)
);

/**
 * @openapi
 * /api/v1/host/teams/{teamId}/leave:
 *   post:
 *     tags: [Equipas]
 *     summary: Sai da equipa (qualquer membro, quando quiser)
 *     responses:
 *       204: { description: Saiu da equipa. }
 *       404:
 *         description: Não é membro.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/teams/:teamId/leave',
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ params: teamIdParamsSchema }),
  asyncHandler(teamController.leave)
);

/**
 * @openapi
 * /api/v1/host/teams/{teamId}:
 *   get:
 *     tags: [Equipas]
 *     summary: Detalhe de uma equipa
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Equipa.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamEnvelope' }
 *       404:
 *         description: Equipa não encontrada ou sem acesso.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   patch:
 *     tags: [Equipas]
 *     summary: Actualiza uma equipa
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
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
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 80 }
 *               category:
 *                 type: string
 *                 enum: [logistica, decoracao, musica, catering, rececao, outra]
 *               description: { type: string, maxLength: 500, nullable: true }
 *     responses:
 *       200:
 *         description: Equipa actualizada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamEnvelope' }
 *       403:
 *         description: A conta não pode gerir equipas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       404:
 *         description: Equipa não encontrada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Equipas]
 *     summary: Remove logicamente uma equipa
 *     description: >
 *       Com tarefas abertas devolve `409 team_has_open_tasks` com a
 *       lista. Repetir com `confirm=true` e `reassign_to_team_id` ou
 *       `archive=true` conclui a remoção na mesma transação.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: confirm
 *         schema: { type: boolean }
 *       - in: query
 *         name: reassign_to_team_id
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: archive
 *         schema: { type: boolean }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Equipa removida.
 *       409:
 *         description: A equipa tem tarefas abertas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/teams/:teamId',
  validate({ params: teamIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(teamController.get)
);

router.patch(
  '/teams/:teamId',
  validate({ params: teamIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: updateTeamSchema }),
  asyncHandler(teamController.update)
);

router.post(
  '/teams/:teamId/photo',
  validate({ params: teamIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  uploadTeamPhoto,
  asyncHandler(teamController.uploadPhoto)
);

router.delete(
  '/teams/:teamId/photo',
  validate({ params: teamIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(teamController.removePhoto)
);

router.delete(
  '/teams/:teamId',
  validate({ params: teamIdParamsSchema, query: deleteTeamQuerySchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(teamController.remove)
);

/**
 * @openapi
 * /api/v1/host/teams/{teamId}/members:
 *   get:
 *     tags: [Equipas]
 *     summary: Lista membros de uma equipa
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [gestor, membro] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ativo, convite_pendente] }
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
 *         description: Membros com contagens e paginação.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamMemberList' }
 *       404:
 *         description: Equipa não encontrada ou sem acesso.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   post:
 *     tags: [Equipas]
 *     summary: Adiciona membros por email
 *     description: >
 *       Normaliza e deduplica os emails, não permite adicionar a própria
 *       conta e devolve `{added, pending, skipped}` com o motivo por
 *       linha. Acima de 50 emails devolve `400 too_many_emails`.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
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
 *           schema:
 *             type: object
 *             required: [emails]
 *             properties:
 *               emails:
 *                 type: array
 *                 items: { type: string, format: email }
 *     responses:
 *       201:
 *         description: Resultado por email.
 *       400:
 *         description: Mais de 50 emails no pedido (`too_many_emails`).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: A conta não pode gerir membros.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get(
  '/teams/:teamId/members',
  validate({ params: teamIdParamsSchema, query: teamMemberListQuerySchema }),
  asyncHandler(hostAccountAuth),
  asyncHandler(teamMemberController.list)
);

router.post(
  '/teams/:teamId/members',
  validate({ params: teamIdParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: addTeamMembersSchema }),
  asyncHandler(teamMemberController.add)
);

/**
 * @openapi
 * /api/v1/host/teams/{teamId}/members/{memberId}:
 *   patch:
 *     tags: [Equipas]
 *     summary: Promove ou despromove um membro
 *     description: >
 *       Promover e despromover são exclusivos do anfitrião
 *       (`403 host_action_forbidden` para gestores). Promover
 *       cria/reactiva o acesso ao evento na mesma transação;
 *       despromover só altera o papel na equipa e não revoga o acesso.
 *       O anfitrião nunca é despromovido.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: memberId
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
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [gestor, membro] }
 *     responses:
 *       200:
 *         description: Papel actualizado.
 *       403:
 *         description: A conta não pode alterar o papel.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *   delete:
 *     tags: [Equipas]
 *     summary: Remove logicamente um membro
 *     description: >
 *       Com tarefas abertas devolve `409 member_has_open_tasks` com a
 *       lista. Repetir com `reassign_to_member_id` reatribui tudo e
 *       remove na mesma transação. O anfitrião nunca é removido.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: reassign_to_member_id
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Membro removido.
 *       409:
 *         description: O membro tem tarefas abertas.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.patch(
  '/teams/:teamId/members/:memberId',
  validate({ params: teamMemberParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  validate({ body: updateTeamMemberRoleSchema }),
  asyncHandler(teamMemberController.updateRole)
);

router.delete(
  '/teams/:teamId/members/:memberId',
  validate({ params: teamMemberParamsSchema, query: removeTeamMemberQuerySchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(teamMemberController.remove)
);

/**
 * @openapi
 * /api/v1/host/teams/{teamId}/members/{memberId}/invite/resend:
 *   post:
 *     tags: [Equipas]
 *     summary: Reenvia o convite de equipa
 *     description: >
 *       Só para membros `convite_pendente`. Cada reenvio rotaciona o
 *       token (o link anterior fica inválido) e está sujeito a
 *       anti-spam: cooldown entre envios, máximo por convite e máximo
 *       por email em 24 horas. Devolve `429 invite_cooldown` ou
 *       `429 invite_rate_limited` quando os limites são atingidos e
 *       `409 invite_send_limit` quando o convite esgotou os reenvios.
 *     security:
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: memberId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Convite reenviado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/TeamInviteResendEnvelope' }
 *       409:
 *         description: O convite já não pode ser reenviado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       429:
 *         description: Limite anti-spam atingido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post(
  '/teams/:teamId/members/:memberId/invite/resend',
  validate({ params: teamMemberParamsSchema }),
  asyncHandler(hostAccountAuth),
  writeLimiter,
  requireAuthCsrf,
  asyncHandler(teamInviteController.resend)
);

export default router;

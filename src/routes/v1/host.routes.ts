import { Router } from 'express';
import { activityController } from '../../controllers/activity.controller';
import { eventController } from '../../controllers/event.controller';
import { eventCoverController } from '../../controllers/eventCover.controller';
import { hostSessionController } from '../../controllers/hostSession.controller';
import { invitationController } from '../../controllers/invitation.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { hostAuth } from '../../middlewares/hostAuth';
import { hostSessionLimiter, writeLimiter } from '../../middlewares/rateLimiter';
import { requireEventHost } from '../../middlewares/requireEventHost';
import { requireHostCsrf } from '../../middlewares/requireHostCsrf';
import { uploadEventCover } from '../../middlewares/uploadEventCover';
import { validate } from '../../middlewares/validate';
import {
  createInvitationSchema,
  eventIdParamsSchema,
  hostSessionSchema,
  invitationIdParamsSchema,
  updateEventSchema,
  updateInvitationSchema,
} from '../../schemas/event.schemas';
import {
  activityIdParamsSchema,
  coverUrlSchema,
} from '../../schemas/host.schemas';
import { invitationLinkSchema } from '../../schemas/invitation.schemas';

const router = Router();

/**
 * @openapi
 * /api/v1/host/session:
 *   post:
 *     tags: [Gestão]
 *     summary: Troca o segredo do link de gestão por uma sessão HttpOnly
 *     description: >
 *       O segredo nunca é devolvido em JSON nem registado. A sessão é
 *       limitada ao evento e expira ao fim de `HOST_SESSION_TTL_MINUTES`.
 *       A resposta inclui o `csrf_token` que o cliente deve enviar em
 *       `X-CSRF-Token` nos pedidos mutáveis, o `email` associado ao link
 *       (anfitrião ou gestor) e `email_has_account`, que indica se esse
 *       email já tem conta registada.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Sessão criada; cookies definidos.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/HostSessionEnvelope' }
 *       404:
 *         description: Link de gestão inválido ou expirado.
 *       429:
 *         description: Demasiadas tentativas.
 */
router.post(
  '/session',
  hostSessionLimiter,
  validate({ body: hostSessionSchema }),
  asyncHandler(hostSessionController.create)
);

/**
 * @openapi
 * /api/v1/host/session/{eventId}:
 *   delete:
 *     tags: [Gestão]
 *     summary: Revoga a sessão de gestão e limpa os cookies
 *     security:
 *       - hostSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204:
 *         description: Sessão revogada.
 *       401:
 *         description: Sessão ausente ou expirada.
 *       403:
 *         description: Token CSRF inválido.
 */
router.delete(
  '/session/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  asyncHandler(hostSessionController.destroy)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}:
 *   get:
 *     tags: [Gestão]
 *     summary: Consulta o evento, estatísticas e lista privada de convidados
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Evento e convidados.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventDetailEnvelope' }
 *       401:
 *         description: Sessão ausente ou expirada.
 *   patch:
 *     tags: [Gestão]
 *     summary: Actualiza o evento e reconcilia lembretes
 *     security:
 *       - hostSession: []
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
 *           schema: { $ref: '#/components/schemas/UpdateEvent' }
 *     responses:
 *       200:
 *         description: Evento actualizado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventEnvelope' }
 *       403:
 *         description: Token CSRF inválido.
 *       422:
 *         description: Dados inválidos.
 */
router.get(
  '/events/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  asyncHandler(eventController.get)
);

router.patch(
  '/events/:eventId',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  validate({ body: updateEventSchema }),
  asyncHandler(eventController.update)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/cover:
 *   put:
 *     tags: [Gestão]
 *     summary: Define a imagem de capa por URL
 *     description: >
 *       Repetir o mesmo URL é idempotente. O anfitrião e os gestores do
 *       evento podem alterar a capa.
 *     security:
 *       - hostSession: []
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
 *           schema:
 *             type: object
 *             required: [cover_url]
 *             properties:
 *               cover_url: { type: string, format: uri }
 *     responses:
 *       200:
 *         description: Evento com a nova capa.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventEnvelope' }
 *       404:
 *         description: Evento não encontrado.
 *   delete:
 *     tags: [Gestão]
 *     summary: Remove a imagem de capa
 *     description: Operação idempotente; devolve o evento sem capa.
 *     security:
 *       - hostSession: []
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
 *       200:
 *         description: Evento actualizado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventEnvelope' }
 *
 * /api/v1/host/events/{eventId}/cover/upload:
 *   post:
 *     tags: [Gestão]
 *     summary: Carrega a imagem de capa (multipart)
 *     description: >
 *       Campo `cover` com JPEG, PNG ou WebP. O upload é idempotente por
 *       conteúdo (SHA-256): repetir o mesmo ficheiro devolve a capa
 *       actual sem voltar a enviar para o Cloudinary.
 *     security:
 *       - hostSession: []
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
 *         description: Evento com a nova capa.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EventEnvelope' }
 *       503:
 *         description: Upload indisponível (`event_cover_upload_unavailable`).
 */
router.put(
  '/events/:eventId/cover',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  validate({ body: coverUrlSchema }),
  asyncHandler(eventCoverController.setUrl)
);

router.post(
  '/events/:eventId/cover/upload',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  uploadEventCover,
  asyncHandler(eventCoverController.upload)
);

router.delete(
  '/events/:eventId/cover',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  asyncHandler(eventCoverController.remove)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/activity/{activityId}:
 *   delete:
 *     tags: [Workspace]
 *     summary: Elimina uma actividade do histórico do evento
 *     description: >
 *       Apenas o anfitrião pode eliminar actividades, e apenas na área
 *       de gestão do evento. A notificação associada é removida.
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: activityId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Actividade removida.
 *       403:
 *         description: Apenas o anfitrião pode remover actividades.
 *       404:
 *         description: Evento ou actividade não encontrados.
 */
router.delete(
  '/events/:eventId/activity/:activityId',
  validate({ params: activityIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  asyncHandler(activityController.remove)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations:
 *   get:
 *     tags: [Convidados]
 *     summary: Lista os convidados do evento
 *     description: >
 *       Cada convite inclui `invitation_url`, um URL absoluto para o
 *       anfitrião partilhar (por exemplo, no WhatsApp). O campo é `null`
 *       quando o convite foi revogado e nunca aparece em respostas
 *       públicas. O link usa o mesmo token do email e não expira.
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Lista de convidados, com o link de partilha por convite.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/InvitationListEnvelope' }
 *       401:
 *         description: Sessão ausente ou expirada (`host_session_invalid`).
 *       404:
 *         description: Evento inexistente ou de outra conta (`event_not_found`).
 *   post:
 *     tags: [Convidados]
 *     summary: Adiciona um convidado e enfileira o convite
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     description: >
 *       Pode usar a sessão de gestão legada do evento ou a sessão de conta
 *       do anfitrião autenticado que é proprietário do evento. Com sessão
 *       de conta não é necessário enviar/trocar o token secreto de gestão.
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
 *           schema: { $ref: '#/components/schemas/InvitationInput' }
 *     responses:
 *       201:
 *         description: Convidado criado e convite enfileirado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/InvitationEnvelope' }
 *       409:
 *         description: >-
 *           Email duplicado, evento não agendado, limite atingido ou email
 *           do anfitrião (`invitation_host_email`).
 */
router.get(
  '/events/:eventId/invitations',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  asyncHandler(invitationController.list)
);

router.post(
  '/events/:eventId/invitations',
  validate({ params: eventIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  validate({ body: createInvitationSchema }),
  asyncHandler(invitationController.add)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations/{invitationId}:
 *   patch:
 *     tags: [Convidados]
 *     summary: Actualiza os dados de um convidado
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
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
 *           schema: { $ref: '#/components/schemas/InvitationInput' }
 *     responses:
 *       200:
 *         description: Convidado actualizado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/InvitationEnvelope' }
 *       404:
 *         description: Convidado não encontrado.
 *       409:
 *         description: >-
 *           Email duplicado, o convidado já abriu o convite
 *           (`invitation_already_opened`), caso em que email e telefone não
 *           podem ser alterados, ou email do anfitrião
 *           (`invitation_host_email`).
 *   delete:
 *     tags: [Convidados]
 *     summary: Remove um convidado e as entregas associadas
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Convidado removido.
 */
router.patch(
  '/events/:eventId/invitations/:invitationId',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  validate({ body: updateInvitationSchema }),
  asyncHandler(invitationController.update)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations/{invitationId}/link:
 *   patch:
 *     tags: [Convidados]
 *     summary: Altera a validade do link do convite
 *     description: >
 *       Data futura, no máximo fim do evento + 30 dias. Não altera a
 *       regra do link de gestão (1 semana / máx. fim + 1 dia).
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expires_at]
 *             properties:
 *               expires_at: { type: string, format: date-time }
 *     responses:
 *       200: { description: Convite com a nova validade. }
 *       422:
 *         description: Data inválida ou além do máximo permitido.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.patch(
  '/events/:eventId/invitations/:invitationId/link',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  validate({ body: invitationLinkSchema }),
  asyncHandler(invitationController.updateLink)
);

router.delete(
  '/events/:eventId/invitations/:invitationId',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  asyncHandler(invitationController.remove)
);

/**
 * @openapi
 * /api/v1/host/events/{eventId}/invitations/{invitationId}/resend:
 *   post:
 *     tags: [Convidados]
 *     summary: Reenvia o convite individual
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       202:
 *         description: Convite enfileirado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/InvitationResendEnvelope' }
 *       409:
 *         description: Convite revogado ou sem link reutilizável.
 *
 * /api/v1/host/events/{eventId}/invitations/{invitationId}/whatsapp-shared:
 *   post:
 *     tags: [Convidados]
 *     summary: Regista que o anfitrião partilhou o link individual no WhatsApp
 *     description: >
 *       A aplicação abre o WhatsApp com a mensagem pré-preenchida; a API não
 *       consegue confirmar o envio. O registo significa apenas que a partilha
 *       foi iniciada para este convite. Pode ser chamada várias vezes.
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Partilha registada, com a contagem actualizada.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/InvitationEnvelope' }
 *       404:
 *         description: Convite não encontrado neste evento.
 *       409:
 *         description: Convite revogado ou sem link partilhável.
 *
 * /api/v1/host/events/{eventId}/invitations/{invitationId}/revoke:
 *   post:
 *     tags: [Convidados]
 *     summary: Revoga o acesso do navegador ao convite
 *     security:
 *       - hostSession: []
 *       - accountSession: []
 *     parameters:
 *       - in: path
 *         name: eventId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: header
 *         name: X-CSRF-Token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Convite revogado.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/InvitationEnvelope' }
 */
router.post(
  '/events/:eventId/invitations/:invitationId/resend',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  asyncHandler(invitationController.resend)
);

router.post(
  '/events/:eventId/invitations/:invitationId/whatsapp-shared',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  asyncHandler(invitationController.whatsappShared)
);

router.post(
  '/events/:eventId/invitations/:invitationId/revoke',
  validate({ params: invitationIdParamsSchema }),
  asyncHandler(hostAuth),
  writeLimiter,
  requireHostCsrf,
  requireEventHost,
  asyncHandler(invitationController.revoke)
);

export default router;

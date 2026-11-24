import { Router } from 'express';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { requireActiveEvent } from '../../middlewares/requireActiveEvent';
import adminRoutes from './admin.routes';
import authRoutes from './auth.routes';
import communitiesRoutes from './communities.routes';
import institutionsRoutes from './institutions.routes';
import { hostSocialRouter, publicSocialRouter } from './social.routes';
import eventsRoutes from './events.routes';
import hostRoutes from './host.routes';
import hostWorkspaceRoutes from './hostWorkspace.routes';
import managePublicRoutes from './managePublic.routes';
import publicEventsRoutes from './publicEvents.routes';
import publicRoutes from './public.routes';
import publicFormsRoutes from './publicForms.routes';
import teamInvitePublicRoutes from './teamInvitePublic.routes';
import templatesRoutes from './templates.routes';

/**
 * Router agregador da v1.
 *
 * Cada router de domínio é montado aqui sem prefixo próprio; este
 * router é montado em `app.ts` sob `/api/v1`. Uma futura v2 encaixa-se
 * criando `src/routes/v2/` no mesmo formato, sem tocar na v1.
 */
const router = Router();

// Bloqueia escritas em eventos cancelados antes de qualquer router de
// domínio. Rotas sem evento resolvido (perfil, auth, criação de evento)
// seguem o fluxo normal.
router.use(asyncHandler(requireActiveEvent()));

router.use('/admin', adminRoutes);
router.use('/templates', templatesRoutes);
router.use('/auth', authRoutes);
router.use('/events', eventsRoutes);
router.use('/host/communities', communitiesRoutes);
router.use('/host/institutions', institutionsRoutes);
router.use('/host', hostSocialRouter);
router.use('/host', hostRoutes);
router.use('/host', hostWorkspaceRoutes);
router.use('/public/invitations', publicRoutes);
router.use('/public/events', publicEventsRoutes);
router.use('/public', publicSocialRouter);
router.use('/public/manage', managePublicRoutes);
router.use('/public/team-invites', teamInvitePublicRoutes);
router.use('/public', publicFormsRoutes);

export default router;

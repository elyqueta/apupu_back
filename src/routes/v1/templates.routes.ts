import { Router } from 'express';
import { templateController } from '../../controllers/template.controller';
import { asyncHandler } from '../../middlewares/asyncHandler';

const router = Router();

/**
 * @openapi
 * /api/v1/templates:
 *   get:
 *     tags: [Templates]
 *     summary: Lista os templates de convite ativos
 *     description: >
 *       A infraestrutura de templates está pronta; os templates visuais
 *       finais serão fornecidos pelo responsável do produto. Uma lista
 *       vazia é uma resposta válida.
 *     responses:
 *       200:
 *         description: Lista de templates ativos.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/EventTemplate' }
 */
router.get('/', asyncHandler(templateController.list));

export default router;

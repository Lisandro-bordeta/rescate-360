import { Router } from 'express';
import { RescueController } from './rescue.controller';
import { authenticate, authorizeRoles } from '../../../middleware/auth.middleware';

const router = Router();
const controller = new RescueController();

router.get(
  '/priority-list',
  authenticate,
  authorizeRoles('rescatista', 'admin'),
  controller.validationRules,
  controller.obtenerListaPrioridad
);

export default router;

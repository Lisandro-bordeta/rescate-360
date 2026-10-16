import { Router } from 'express';
import { SyncController } from './sync.controller';
import { authenticate } from '../../../middleware/auth.middleware';

const router = Router();
const controller = new SyncController();

router.post('/locations-batch', authenticate, controller.validationRules, controller.recibirLoteUbicaciones);
router.post('/confirmar-sincronizados', authenticate, controller.confirmarSincronizados);

export default router;

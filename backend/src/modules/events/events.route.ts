import { Router } from 'express';
import { EventsController } from './events.controller';
import { authenticate } from '../../../middleware/auth.middleware';

const router = Router();
const controller = new EventsController();

router.post('/', authenticate, controller.registrar);

export default router;

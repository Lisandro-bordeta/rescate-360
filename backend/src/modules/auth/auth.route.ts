import { Router } from 'express';
import { AuthController } from './auth.controller';

const router = Router();
const controller = new AuthController();

router.post('/mi-argentina/login', controller.loginWithMiArgentina);
router.get('/me', controller.me);

export default router;

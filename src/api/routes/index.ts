import { Router } from 'express';
import locationRoutes from './location.routes';
import sunsetRoutes from './sunset.routes';
import healthRoutes from './health.routes';

const router = Router();

// Mount route modules
router.use('/location', locationRoutes);
router.use('/sunset', sunsetRoutes);
router.use('/health', healthRoutes);

export default router;

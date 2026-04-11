import { Router } from 'express';
import * as sunsetController from '../controllers/sunset.controller';

const router = Router();

/**
 * POST /api/sunset/forecast
 * Get sunset forecast for coordinates
 */
router.post('/forecast', sunsetController.getForecast);
/**
 * POST /api/sunset/historical
 * Get historical sunset score for a specific date
 */
router.post('/historical', sunsetController.getHistorical);
/**
 * POST /api/sunset/historical/best
 * Get the top historical sunset days for the current calendar year
 */
router.post('/historical/best', sunsetController.getBestHistorical);
export default router;

import { Router } from 'express';
import * as locationController from '../controllers/location.controller';

const router = Router();

/**
 * POST /api/location/reverse
 * Convert coordinates to location name
 */
router.post('/reverse', locationController.reverseGeocode);

export default router;

// backend/src/routes/cliAuthRoutes.ts
import { Router } from 'express';
import {
  createCliAuthRequest,
  completeCliAuthRequest,
  getCliAuthRequestStatus,
} from '../controllers/cliAuthController';

const router = Router();

// Route for CLI to create a new auth request
router.post('/request', createCliAuthRequest); // POST /api/cli-auth/request

// Route for the web dashboard to complete an auth request
router.post('/complete', completeCliAuthRequest); // POST /api/cli-auth/complete

// Route for CLI to poll for auth request status
router.get('/status', getCliAuthRequestStatus); // GET /api/cli-auth/status?cliAuthToken=...

export default router;
// backend/src/routes/codeRoutes.ts
import { Router } from 'express';
import {
  getBranches,
  getTags,
  getTree,
  getBlob,
  getReadme,
  updateReadme,
  getContributors,
} from '../controllers/codeController';

const router = Router();

// Project-level “Code” endpoints
router.get('/:id/branches', getBranches);
router.get('/:id/tags', getTags);
router.get('/:id/tree', getTree);
router.get('/:id/blob', getBlob);
router.get('/:id/readme', getReadme);
router.put('/:id/readme', updateReadme);
router.get('/:id/contributors', getContributors);

export default router;
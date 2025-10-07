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
  createFile, // NEW: Import createFile
  createFolder, // NEW: Import createFolder
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
router.post('/:id/files', createFile);     // NEW: Route for creating files
router.post('/:id/folders', createFolder); // NEW: Route for creating folders

export default router;
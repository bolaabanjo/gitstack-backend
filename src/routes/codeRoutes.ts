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
  createFile,
  createFolder,
  deleteFile,   // NEW: Import deleteFile
  deleteFolder, // NEW: Import deleteFolder
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
router.post('/:id/files', createFile);
router.post('/:id/folders', createFolder);
router.delete('/:id/files', deleteFile);     // NEW: Route for deleting files
router.delete('/:id/folders', deleteFolder); // NEW: Route for deleting folders

export default router;
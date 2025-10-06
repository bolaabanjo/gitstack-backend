// backend/src/routes/snapshotRoutes.ts
import { Router } from 'express';
import {
  createSnapshot,
  getSnapshots,
  getSnapshotById,
  deleteSnapshot,
} from '../controllers/snapshotController';

const router = Router();

// Routes for snapshots
router.post('/', createSnapshot);         // POST /api/snapshots
router.get('/', getSnapshots);            // GET /api/snapshots?projectId=...&userId=...
router.get('/:id', getSnapshotById);      // GET /api/snapshots/:id
router.delete('/:id', deleteSnapshot);    // DELETE /api/snapshots/:id

export default router;
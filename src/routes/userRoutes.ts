// backend/src/routes/userRoutes.ts
import { Router } from 'express';
import { createOrGetUser, getUserProfile } from '../controllers/userController';

const router = Router();

// Route to create a user if they don't exist, or get their internal ID
router.post('/create-or-get', createOrGetUser); // POST /api/users/create-or-get

// Placeholder for future user routes
router.get('/:id', getUserProfile); // GET /api/users/:id

export default router;
// backend/src/routes/projectRoutes.ts
import { Router } from 'express';
import { createProject, getProjects, getProjectById, updateProject, deleteProject } from '../controllers/projectController';

const router = Router();

// Routes for projects
router.post('/', createProject);       // POST /api/projects
router.get('/', getProjects);          // GET /api/projects?ownerId=...
router.get('/:id', getProjectById);    // GET /api/projects/:id

// Future routes
router.put('/:id', updateProject);     // PUT /api/projects/:id
router.delete('/:id', deleteProject);  // DELETE /api/projects/:id

export default router;
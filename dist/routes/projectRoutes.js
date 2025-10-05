"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/routes/projectRoutes.ts
const express_1 = require("express");
const projectController_1 = require("../controllers/projectController");
const router = (0, express_1.Router)();
// Routes for projects
router.post('/', projectController_1.createProject); // POST /api/projects
router.get('/', projectController_1.getProjects); // GET /api/projects?ownerId=...
router.get('/:id', projectController_1.getProjectById); // GET /api/projects/:id
// Future routes
router.put('/:id', projectController_1.updateProject); // PUT /api/projects/:id
router.delete('/:id', projectController_1.deleteProject); // DELETE /api/projects/:id
exports.default = router;

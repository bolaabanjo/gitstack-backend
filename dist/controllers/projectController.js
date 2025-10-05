"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProject = exports.updateProject = exports.getProjectById = exports.getProjects = exports.createProject = exports.setDbPool = void 0;
// We'll pass the pool from server.ts to the controller
let pool;
const setDbPool = (dbPool) => {
    pool = dbPool;
};
exports.setDbPool = setDbPool;
// --- API Endpoint Implementations ---
// Create a new project
const createProject = async (req, res) => {
    const { name, description, visibility, ownerId } = req.body; // ownerId will come from auth later
    // Basic validation (more robust validation with Zod can be added here)
    if (!name || !ownerId || !visibility) {
        return res.status(400).json({ error: 'Name, ownerId, and visibility are required.' });
    }
    if (!['public', 'private'].includes(visibility)) {
        return res.status(400).json({ error: 'Visibility must be either "public" or "private".' });
    }
    const client = await pool.connect();
    try {
        const now = Date.now(); // Milliseconds since epoch
        const result = await client.query(`INSERT INTO projects (name, description, visibility, created_at, updated_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, visibility, created_at, updated_at, owner_id,
                 stats_snapshots, stats_deployments, stats_last_deployed`, [name, description, visibility, now, now, ownerId]);
        res.status(201).json(result.rows[0]);
    }
    catch (error) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        client.release();
    }
};
exports.createProject = createProject;
// Get all projects for a given owner (or public projects)
const getProjects = async (req, res) => {
    const { ownerId } = req.query; // Expect ownerId as a query parameter
    if (!ownerId) {
        return res.status(400).json({ error: 'ownerId is required to fetch projects.' });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT id, name, description, visibility, created_at, updated_at, owner_id,
              stats_snapshots, stats_deployments, stats_last_deployed
       FROM projects
       WHERE owner_id = $1
       ORDER BY created_at DESC`, // Order by creation date, newest first
        [ownerId]);
        res.status(200).json(result.rows);
    }
    catch (error) {
        console.error('Error fetching projects:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        client.release();
    }
};
exports.getProjects = getProjects;
// Get a project by its ID
const getProjectById = async (req, res) => {
    const { id } = req.params; // Project ID from URL parameter
    if (!id) {
        return res.status(400).json({ error: 'Project ID is required.' });
    }
    const client = await pool.connect();
    try {
        const result = await client.query(`SELECT id, name, description, visibility, created_at, updated_at, owner_id,
              stats_snapshots, stats_deployments, stats_last_deployed
       FROM projects
       WHERE id = $1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Project not found.' });
        }
        res.status(200).json(result.rows[0]);
    }
    catch (error) {
        console.error('Error fetching project by ID:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
    finally {
        client.release();
    }
};
exports.getProjectById = getProjectById;
// Placeholder for future update/delete operations
const updateProject = async (req, res) => {
    res.status(501).json({ message: 'Not yet implemented.' });
};
exports.updateProject = updateProject;
const deleteProject = async (req, res) => {
    res.status(501).json({ message: 'Not yet implemented.' });
};
exports.deleteProject = deleteProject;

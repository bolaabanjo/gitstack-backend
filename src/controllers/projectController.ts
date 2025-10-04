// backend/src/controllers/projectController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid'; // For generating UUIDs if not using DB default

// We'll pass the pool from server.ts to the controller
let pool: Pool;

export const setDbPool = (dbPool: Pool) => {
  pool = dbPool;
};

// --- API Endpoint Implementations ---

// Create a new project
export const createProject = async (req: Request, res: Response) => {
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
    const result = await client.query(
      `INSERT INTO projects (name, description, visibility, created_at, updated_at, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, description, visibility, created_at, updated_at, owner_id,
                 stats_snapshots, stats_deployments, stats_last_deployed`,
      [name, description, visibility, now, now, ownerId]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// Get all projects for a given owner (or public projects)
export const getProjects = async (req: Request, res: Response) => {
  const { ownerId } = req.query; // Expect ownerId as a query parameter

  if (!ownerId) {
    return res.status(400).json({ error: 'ownerId is required to fetch projects.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, name, description, visibility, created_at, updated_at, owner_id,
              stats_snapshots, stats_deployments, stats_last_deployed
       FROM projects
       WHERE owner_id = $1
       ORDER BY created_at DESC`, // Order by creation date, newest first
      [ownerId]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// Get a project by its ID
export const getProjectById = async (req: Request, res: Response) => {
  const { id } = req.params; // Project ID from URL parameter

  if (!id) {
    return res.status(400).json({ error: 'Project ID is required.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, name, description, visibility, created_at, updated_at, owner_id,
              stats_snapshots, stats_deployments, stats_last_deployed
       FROM projects
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching project by ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// Placeholder for future update/delete operations
export const updateProject = async (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented.' });
};

export const deleteProject = async (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented.' });
};
// backend/src/controllers/snapshotController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';

let pool: Pool;

export const setDbPool = (dbPool: Pool) => {
  pool = dbPool;
};

// --- Interfaces for Request/Response (matching CLI expectations) ---
interface FileData {
  path: string;
  hash: string;
  size?: number; // Optional, CLI might not provide directly
  mode?: number; // Optional
}

interface SnapshotPayload {
  projectId: string; // The project this snapshot belongs to (PostgreSQL UUID)
  userId: string;    // The user who created the snapshot (PostgreSQL UUID)
  title?: string;
  description?: string;
  timestamp: number; // Milliseconds since epoch, from CLI
  externalId?: string; // e.g., a Git commit hash
  files: FileData[]; // Array of file data for snapshot_files
}

// 1. Create a new snapshot and its associated files
export const createSnapshot = async (req: Request, res: Response) => {
  const { projectId, userId, title, description, timestamp, externalId, files }: SnapshotPayload = req.body;

  // Basic validation
  if (!projectId || !userId || !timestamp || !Array.isArray(files)) {
    return res.status(400).json({ error: 'projectId, userId, timestamp, and files array are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // Start transaction

    const now = Date.now();
    const fileCount = files.length;

    // Insert into snapshots table
    const snapshotResult = await client.query(
      `INSERT INTO snapshots (project_id, user_id, title, description, timestamp, file_count, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, project_id, user_id, title, description, timestamp, file_count, external_id`,
      [projectId, userId, title, description, timestamp, fileCount, externalId]
    );
    const newSnapshot = snapshotResult.rows[0];

    // If there are files, insert them into snapshot_files table
    if (files.length > 0) {
      const fileInsertPromises = files.map(file =>
        client.query(
          `INSERT INTO snapshot_files (snapshot_id, path, hash, size, mode)
           VALUES ($1, $2, $3, $4, $5)`,
          [newSnapshot.id, file.path, file.hash, file.size, file.mode]
        )
      );
      await Promise.all(fileInsertPromises);
    }

    await client.query('COMMIT'); // Commit transaction
    res.status(201).json(newSnapshot);

  } catch (error) {
    await client.query('ROLLBACK'); // Rollback on error
    console.error('Error creating snapshot:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// 2. Get all snapshots (optionally filtered by projectId or userId)
export const getSnapshots = async (req: Request, res: Response) => {
  const { projectId, userId } = req.query; // Filter by project or user

  const client = await pool.connect();
  try {
    let query = `SELECT id, project_id, user_id, title, description, timestamp, file_count, external_id FROM snapshots`;
    const queryParams: (string | undefined)[] = [];
    const conditions: string[] = [];
    let paramIndex = 1;

    if (projectId) {
      conditions.push(`project_id = $${paramIndex++}`);
      queryParams.push(projectId as string);
    }
    if (userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      queryParams.push(userId as string);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY timestamp DESC`; // Order by newest first

    const result = await client.query(query, queryParams);
    res.status(200).json(result.rows);

  } catch (error) {
    console.error('Error fetching snapshots:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// 3. Get a single snapshot by ID (with its files)
export const getSnapshotById = async (req: Request, res: Response) => {
  const { id } = req.params; // Snapshot ID from URL parameter

  if (!id) {
    return res.status(400).json({ error: 'Snapshot ID is required.' });
  }

  const client = await pool.connect();
  try {
    // Fetch snapshot details
    const snapshotResult = await client.query(
      `SELECT id, project_id, user_id, title, description, timestamp, file_count, external_id
       FROM snapshots
       WHERE id = $1`,
      [id]
    );

    if (snapshotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found.' });
    }
    const snapshot = snapshotResult.rows[0];

    // Fetch associated files
    const filesResult = await client.query(
      `SELECT id, snapshot_id, path, hash, size, mode
       FROM snapshot_files
       WHERE snapshot_id = $1`,
      [id]
    );
    snapshot.files = filesResult.rows; // Attach files to the snapshot object

    res.status(200).json(snapshot);

  } catch (error) {
    console.error('Error fetching snapshot by ID:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// 4. Delete a snapshot by ID
export const deleteSnapshot = async (req: Request, res: Response) => {
  const { id } = req.params; // Snapshot ID from URL parameter

  if (!id) {
    return res.status(400).json({ error: 'Snapshot ID is required.' });
  }

  const client = await pool.connect();
  try {
    // Due to ON DELETE CASCADE, deleting the snapshot will automatically delete
    // associated snapshot_files.
    const result = await client.query(
      `DELETE FROM snapshots
       WHERE id = $1
       RETURNING id`, // Return the ID of the deleted snapshot
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found.' });
    }
    res.status(200).json({ message: 'Snapshot deleted successfully.', id: result.rows[0].id });

  } catch (error) {
    console.error('Error deleting snapshot:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};
// backend/src/controllers/snapshotController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { supabaseService, SUPABASE_BUCKET_NAME } from '../services/supabase'; // NEW: Import Supabase client and bucket name

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
  content?: string;
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
      `INSERT INTO snapshots (project_id, user_id, title, description, timestamp, file_count, external_id)\r
       VALUES ($1, $2, $3, $4, $5, $6, $7)\r
       RETURNING id, project_id, user_id, title, description, timestamp, file_count, external_id`,
      [projectId, userId, title, description, timestamp, fileCount, externalId]
    );
    const newSnapshot = snapshotResult.rows[0];

    // If there are files, insert them into snapshot_files table
    if (files.length > 0) {
      const fileInsertPromises = files.map(async (file) => {
        // Upload content to Supabase if provided
        if (file.content) {
          const contentBuffer = Buffer.from(file.content, 'base64');
          const filePathInStorage = `${projectId}/${newSnapshot.id}/${file.hash}`; // Store by project/snapshot/hash

          const { error: uploadError } = await supabaseService.storage
            .from(SUPABASE_BUCKET_NAME)
            .upload(filePathInStorage, contentBuffer, {
              cacheControl: '3600',
              upsert: true, // Allow overwriting if hash is the same (e.g., retries)
              contentType: 'application/octet-stream', // Generic, can be improved with mime detection
            });

          if (uploadError) {
            console.error(`Supabase upload error for file ${file.path}:`, uploadError.message);
            throw new Error(`Failed to upload file content for ${file.path}`);
          }
        }

        // Insert file metadata into PostgreSQL
        return client.query(
          `INSERT INTO snapshot_files (snapshot_id, path, hash, size, mode)\r
           VALUES ($1, $2, $3, $4, $5)`,
          [newSnapshot.id, file.path, file.hash, file.size, file.mode]
        );
      });
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
    // Before deleting the snapshot record, find its files to delete from Supabase
    const filesResult = await client.query(
      `SELECT path, hash FROM snapshot_files WHERE snapshot_id = $1`,
      [id]
    );

    await client.query('BEGIN'); // Start transaction for DB deletion

    // Due to ON DELETE CASCADE, deleting the snapshot will automatically delete
    // associated snapshot_files.
    const result = await client.query(
      `DELETE FROM snapshots
       WHERE id = $1
       RETURNING id, project_id`, // Also return project_id to construct Supabase paths
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Snapshot not found.' });
    }
    const { id: deletedSnapshotId, project_id: deletedProjectId } = result.rows[0];

    // Delete files from Supabase Storage
    if (filesResult.rows.length > 0 && deletedProjectId) {
      const pathsToDelete = filesResult.rows.map(
        (file) => `${deletedProjectId}/${deletedSnapshotId}/${file.hash}`
      );
      const { error: deleteError } = await supabaseService.storage
        .from(SUPABASE_BUCKET_NAME)
        .remove(pathsToDelete);

      if (deleteError) {
        console.error(`Supabase delete error for snapshot ${deletedSnapshotId}:`, deleteError.message);
        // Do not throw here, as the DB deletion was successful. Log and continue.
      }
    }

    await client.query('COMMIT'); // Commit DB transaction
    res.status(200).json({ message: 'Snapshot deleted successfully.', id: deletedSnapshotId });

  } catch (error) {
    console.error('Error deleting snapshot:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};
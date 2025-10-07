// backend/src/controllers/codeController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { supabaseService, SUPABASE_BUCKET_NAME } from '../services/supabase';
import path from 'path';
import mime from 'mime-types';
import crypto from 'crypto'; // NEW: Import crypto for hashing

let pool: Pool;
export const setDbPool = (dbPool: Pool) => { pool = dbPool; };

// Helper: resolve head snapshot for branch, else latest snapshot
async function resolveSnapshotId(client: any, projectId: string, branch?: string): Promise<string | null> {
  if (branch) {
    const br = await client.query(
      `SELECT head_snapshot_id FROM branches WHERE project_id = $1 AND name = $2 LIMIT 1`,
      [projectId, branch]
    );
    if (br.rows.length && br.rows[0].head_snapshot_id) return br.rows[0].head_snapshot_id;
  }
  const latest = await client.query(
    `SELECT id FROM latest_project_snapshot WHERE project_id = $1 LIMIT 1`,
    [projectId]
  );
  return latest.rows[0]?.id ?? null;
}

// Helper: Get files for a given snapshot
async function getFilesInSnapshot(client: any, snapshotId: string): Promise<Array<{ path: string; hash: string; size: number; mode: number }>> {
  const result = await client.query(
    `SELECT path, hash, size, mode FROM snapshot_files WHERE snapshot_id = $1`,
    [snapshotId]
  );
  return result.rows;
}

// Helper: Create a new snapshot
async function createNewSnapshot(
  client: any,
  projectId: string,
  userId: string,
  files: Array<{ path: string; hash: string; size: number; mode: number }>,
  title: string = 'Automated snapshot',
  description?: string,
  externalId?: string
) {
  const now = Date.now();
  const fileCount = files.length;

  const snapshotResult = await client.query(
    `INSERT INTO snapshots (project_id, user_id, title, description, timestamp, file_count, external_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [projectId, userId, title, description, now, fileCount, externalId]
  );
  const newSnapshotId = snapshotResult.rows[0].id;

  if (files.length > 0) {
    const fileInsertPromises = files.map(file =>
      client.query(
        `INSERT INTO snapshot_files (snapshot_id, path, hash, size, mode)
         VALUES ($1, $2, $3, $4, $5)`,
        [newSnapshotId, file.path, file.hash, file.size, file.mode]
      )
    );
    await Promise.all(fileInsertPromises);
  }
  return newSnapshotId;
}

// Helper: Update branch head
async function updateBranchHead(client: any, projectId: string, branch: string, newSnapshotId: string) {
  const now = Date.now();
  await client.query(
    `UPDATE branches SET head_snapshot_id = $1, updated_at = $2 WHERE project_id = $3 AND name = $4`,
    [newSnapshotId, now, projectId, branch]
  );
}

// --- File/Folder Creation Endpoints ---

export const createFile = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path: filePath, content, userId } = req.body as {
    branch: string;
    path: string;
    content: string; // Base64 encoded
    userId: string;
  };

  if (!branch || !filePath || typeof content !== 'string' || !userId) {
    console.error('createFile: Missing required fields (branch, path, content, userId).');
    return res.status(400).json({ error: 'Branch, path, content, and userId are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`createFile: Starting transaction for project ${projectId}, branch ${branch}, path ${filePath}`);

    const currentSnapshotId = await resolveSnapshotId(client, projectId, branch);
    let existingFiles: Array<{ path: string; hash: string; size: number; mode: number }> = [];
    if (currentSnapshotId) {
      existingFiles = await getFilesInSnapshot(client, currentSnapshotId);
      console.log(`createFile: Found existing snapshot ${currentSnapshotId} with ${existingFiles.length} files.`);
    } else {
      console.log('createFile: No current snapshot, starting with empty file list.');
    }

    const contentBuffer = Buffer.from(content, 'base64');
    const fileHash = crypto.createHash('sha256').update(contentBuffer).digest('hex');
    const fileSize = contentBuffer.byteLength;
    const fileMode = 644;

    const filteredFiles = existingFiles.filter(f => f.path !== filePath);
    const newFile = { path: filePath, hash: fileHash, size: fileSize, mode: fileMode };
    const allFiles = [...filteredFiles, newFile];
    console.log(`createFile: New file ${filePath} with hash ${fileHash}, size ${fileSize}. Total files for new snapshot: ${allFiles.length}`);

    // Supabase Upload
    const filePathInStorage = `${projectId}/${newFile.hash}`;
    console.log(`createFile: Attempting Supabase upload to bucket "${SUPABASE_BUCKET_NAME}", path "${filePathInStorage}"`);
    const { error: uploadError } = await supabaseService.storage
      .from(SUPABASE_BUCKET_NAME)
      .upload(filePathInStorage, contentBuffer, {
        cacheControl: '3600',
        upsert: true,
        contentType: mime.lookup(filePath) || 'application/octet-stream',
      });

    if (uploadError) {
      console.error(`createFile: Supabase upload FAILED for file ${filePath}:`, uploadError.message, uploadError);
      throw new Error(`Failed to upload file content for ${filePath} to Supabase: ${uploadError.message}`);
    }
    console.log(`createFile: Supabase upload SUCCESS for file ${filePath}.`);


    const newSnapshotId = await createNewSnapshot(
      client,
      projectId,
      userId,
      allFiles,
      `Create file: ${filePath}`
    );
    console.log(`createFile: Created new snapshot ${newSnapshotId}.`);

    await updateBranchHead(client, projectId, branch, newSnapshotId);
    console.log(`createFile: Updated branch ${branch} to point to snapshot ${newSnapshotId}.`);

    await client.query('COMMIT');
    console.log('createFile: Transaction committed successfully.');
    res.status(201).json({ snapshotId: newSnapshotId, newFile });
  } catch (e: any) { // Catch as 'any' for simpler logging
    await client.query('ROLLBACK');
    console.error('createFile: Transaction rolled back. Error details:', e.message, e.stack || e);
    res.status(500).json({ error: e.message || 'Internal server error' }); // Return specific error message
  } finally {
    client.release();
    console.log('createFile: Database client released.');
  }
};

export const createFolder = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path: folderPath, userId } = req.body as {
    branch: string;
    path: string;
    userId: string;
  };

  if (!branch || !folderPath || !userId) {
    console.error('createFolder: Missing required fields (branch, path, userId).');
    return res.status(400).json({ error: 'Branch, path, and userId are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`createFolder: Starting transaction for project ${projectId}, branch ${branch}, folder ${folderPath}`);

    const currentSnapshotId = await resolveSnapshotId(client, projectId, branch);
    let existingFiles: Array<{ path: string; hash: string; size: number; mode: number }> = [];
    if (currentSnapshotId) {
      existingFiles = await getFilesInSnapshot(client, currentSnapshotId);
      console.log(`createFolder: Found existing snapshot ${currentSnapshotId} with ${existingFiles.length} files.`);
    } else {
      console.log('createFolder: No current snapshot, starting with empty file list for .gitkeep.');
    }

    const gitkeepPath = path.join(folderPath, '.gitkeep');
    const gitkeepContent = Buffer.from('');
    const gitkeepHash = crypto.createHash('sha256').update(gitkeepContent).digest('hex');
    const gitkeepSize = 0;
    const gitkeepMode = 644;

    const filteredFiles = existingFiles.filter(f => f.path !== gitkeepPath);
    const newGitkeepFile = { path: gitkeepPath, hash: gitkeepHash, size: gitkeepSize, mode: gitkeepMode };
    const allFiles = [...filteredFiles, newGitkeepFile];
    console.log(`createFolder: New .gitkeep file ${gitkeepPath} for folder. Total files for new snapshot: ${allFiles.length}`);

    // Supabase Upload for .gitkeep
    const filePathInStorage = `${projectId}/${newGitkeepFile.hash}`;
    console.log(`createFolder: Attempting Supabase upload for .gitkeep to bucket "${SUPABASE_BUCKET_NAME}", path "${filePathInStorage}"`);

    const { error: uploadError } = await supabaseService.storage
      .from(SUPABASE_BUCKET_NAME)
      .upload(filePathInStorage, gitkeepContent, {
        cacheControl: '3600',
        upsert: true,
        contentType: 'text/plain',
      });

    if (uploadError) {
      console.error(`createFolder: Supabase upload FAILED for .gitkeep in ${folderPath}:`, uploadError.message, uploadError);
      // Do not throw here, as the folder can still be created logically in DB
      // We will still create the snapshot entry even if .gitkeep content upload fails
      console.warn(`createFolder: Continuing without .gitkeep content in storage due to upload error.`);
    } else {
      console.log(`createFolder: Supabase upload SUCCESS for .gitkeep in ${folderPath}.`);
    }

    const newSnapshotId = await createNewSnapshot(
      client,
      projectId,
      userId,
      allFiles,
      `Create folder: ${folderPath}`
    );
    console.log(`createFolder: Created new snapshot ${newSnapshotId}.`);

    await updateBranchHead(client, projectId, branch, newSnapshotId);
    console.log(`createFolder: Updated branch ${branch} to point to snapshot ${newSnapshotId}.`);

    await client.query('COMMIT');
    console.log('createFolder: Transaction committed successfully.');
    res.status(201).json({ snapshotId: newSnapshotId, newFolder: { path: folderPath, type: 'dir' } });
  } catch (e: any) { // Catch as 'any' for simpler logging
    await client.query('ROLLBACK');
    console.error('createFolder: Transaction rolled back. Error details:', e.message, e.stack || e);
    res.status(500).json({ error: e.message || 'Internal server error' }); // Return specific error message
  } finally {
    client.release();
    console.log('createFolder: Database client released.');
  }
};

// --- NEW: File/Folder Deletion Endpoints ---

export const deleteFile = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path: filePath, userId } = req.body as {
    branch: string;
    path: string;
    userId: string;
  };

  if (!branch || !filePath || !userId) {
    return res.status(400).json({ error: 'Branch, path, and userId are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentSnapshotId = await resolveSnapshotId(client, projectId, branch);
    if (!currentSnapshotId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Branch or project has no snapshots.' });
    }

    const existingFiles = await getFilesInSnapshot(client, currentSnapshotId);

    // Filter out the file to be deleted
    const updatedFiles = existingFiles.filter(f => f.path !== filePath);

    if (existingFiles.length === updatedFiles.length) {
      // File was not found in the current snapshot
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `File not found at path: ${filePath}` });
    }

    // Create new snapshot with the file removed
    const newSnapshotId = await createNewSnapshot(
      client,
      projectId,
      userId,
      updatedFiles,
      `Delete file: ${filePath}`
    );

    // Update branch head
    await updateBranchHead(client, projectId, branch, newSnapshotId);

    await client.query('COMMIT');
    res.status(200).json({ snapshotId: newSnapshotId, deletedPath: filePath });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('deleteFile error', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

export const deleteFolder = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path: folderPath, userId } = req.body as {
    branch: string;
    path: string;
    userId: string;
  };

  if (!branch || !folderPath || !userId) {
    return res.status(400).json({ error: 'Branch, path, and userId are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const currentSnapshotId = await resolveSnapshotId(client, projectId, branch);
    if (!currentSnapshotId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Branch or project has no snapshots.' });
    }

    const existingFiles = await getFilesInSnapshot(client, currentSnapshotId);

    const folderPrefix = folderPath.endsWith('/') ? folderPath : folderPath + '/';

    // Filter out all files and folders that are descendants of the folder to be deleted
    // This includes any .gitkeep file within the folder
    const updatedFiles = existingFiles.filter(f => !f.path.startsWith(folderPrefix));

    if (existingFiles.length === updatedFiles.length) {
        // No files were removed, implying the folder (or its contents) didn't exist
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Folder not found or already empty at path: ${folderPath}` });
    }


    // Create new snapshot with the folder and its contents removed
    const newSnapshotId = await createNewSnapshot(
      client,
      projectId,
      userId,
      updatedFiles,
      `Delete folder: ${folderPath}`
    );

    // Update branch head
    await updateBranchHead(client, projectId, branch, newSnapshotId);

    await client.query('COMMIT');
    res.status(200).json({ snapshotId: newSnapshotId, deletedPath: folderPath });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('deleteFolder error', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};



// GET /api/projects/:id/branches, getTags, getTree, getBlob, getReadme, updateReadme, getContributors (existing functions)
// ... (all your existing codeController.ts functions go here after the new ones) ...

// GET /api/projects/:id/branches
export const getBranches = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const client = await pool.connect();
  try {
    const now = Date.now();

    // Ensure at least a 'main' branch exists; if not, create one pointing to latest snapshot (if any)
    const existing = await client.query(
      `SELECT id, name, head_snapshot_id FROM branches WHERE project_id = $1 ORDER BY name ASC`,
      [projectId]
    );
    if (existing.rows.length === 0) {
      const latest = await client.query(
        `SELECT id FROM latest_project_snapshot WHERE project_id = $1 LIMIT 1`,
        [projectId]
      );
      const headId = latest.rows[0]?.id ?? null;
      await client.query(
        `INSERT INTO branches (project_id, name, head_snapshot_id, created_at, updated_at)
         VALUES ($1, 'main', $2, $3, $3)`,
        [projectId, headId, now]
      );
    }

    const result = await client.query(
      `SELECT id, name, head_snapshot_id FROM branches WHERE project_id = $1 ORDER BY name ASC`,
      [projectId]
    );
    return res.status(200).json(result.rows);
  } catch (e) {
    console.error('getBranches error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// GET /api/projects/:id/tags
export const getTags = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, name, snapshot_id FROM tags WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return res.status(200).json(result.rows);
  } catch (e) {
    console.error('getTags error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// GET /api/projects/:id/tree?branch=main&path=
export const getTree = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path = '' } = req.query as { branch?: string; path?: string };
  const client = await pool.connect();
  try {
    const snapshotId = await resolveSnapshotId(client, projectId, branch);
    if (!snapshotId) return res.status(200).json([]); // no snapshots yet

    const basePath = (path || '').replace(/^\/+|\/+$/g, '');
    const likePrefix = basePath ? basePath + '/' : '';

    // Collect all files under basePath
    const files = await client.query(
      `SELECT path, size, mode FROM snapshot_files WHERE snapshot_id = $1 AND path LIKE $2 || '%' ORDER BY path ASC`,
      [snapshotId, likePrefix]
    );

    // Build immediate children for the tree level
    const seen = new Set<string>();
    const entries: Array<{ name: string; type: 'dir' | 'file'; size?: number }> = [];

    for (const row of files.rows) {
      const rel = row.path.slice(likePrefix.length);
      const slash = rel.indexOf('/');
      if (slash === -1) {
        // file at this level
        const name = rel;
        if (!seen.has(name)) {
          seen.add(name);
          entries.push({ name, type: 'file', size: row.size ?? undefined });
        }
      } else {
        // subfolder
        const dir = rel.slice(0, slash);
        if (!seen.has(dir)) {
          seen.add(dir);
          entries.push({ name: dir, type: 'dir' });
        }
      }
    }

    return res.status(200).json(entries);
  } catch (e) {
    console.error('getTree error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// GET /api/projects/:id/blob?branch=main&path=...
export const getBlob = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path: filePath = '' } = req.query as { branch?: string; path?: string };
  const client = await pool.connect();
  let fileContent: string | null = null;
  let fileMime: string | null = null;
  let message: string | undefined = undefined;

  try {
    const snapshotId = await resolveSnapshotId(client, projectId, branch);
    if (!snapshotId) {
      return res.status(404).json({ error: 'No snapshot for this branch/project', content: null, mime: null });
    }

    const fileMetadata = await client.query(
      `SELECT path, hash, size, mode FROM snapshot_files WHERE snapshot_id = $1 AND path = $2 LIMIT 1`,
      [snapshotId, filePath]
    );

    if (!fileMetadata.rows.length) {
      return res.status(404).json({ error: 'File not found', content: null, mime: null });
    }

    const file = fileMetadata.rows[0];
    const filePathInStorage = `${projectId}/${snapshotId}/${file.hash}`;

    // Guess MIME type
    fileMime = mime.lookup(filePath) || 'application/octet-stream';

    // Attempt to download content from Supabase Storage
    const { data, error: downloadError } = await supabaseService.storage
      .from(SUPABASE_BUCKET_NAME)
      .download(filePathInStorage);

    if (downloadError) {
      console.warn(`Supabase download error for ${filePathInStorage}:`, downloadError.message);
      message = `Could not download file content: ${downloadError.message}`;
    } else if (data) {
      // Convert Blob to base64 string
      const buffer = await data.arrayBuffer();
      fileContent = Buffer.from(buffer).toString('base64');
      message = undefined; // Clear any warning messages if content is found
    } else {
      message = 'File content not found in storage.';
    }

    return res.status(200).json({
      path: file.path,
      hash: file.hash,
      size: file.size,
      mode: file.mode,
      content: fileContent, // This will be base64 string or null
      mime: fileMime,
      message: message, // Include message if any warnings/errors occurred during download
    });

  } catch (e) {
    console.error('getBlob error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// GET /api/projects/:id/readme?branch=main
export const getReadme = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch = 'main' } = req.query as { branch?: string };
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT content, updated_at, updated_by FROM project_readmes WHERE project_id = $1 AND branch = $2 LIMIT 1`,
      [projectId, branch]
    );
    if (!result.rows.length) return res.status(200).json({ content: '', updated_at: null, updated_by: null });
    return res.status(200).json(result.rows[0]);
  } catch (e) {
    console.error('getReadme error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// PUT /api/projects/:id/readme  { branch, content, userId }
export const updateReadme = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch = 'main', content, userId } = req.body as { branch?: string; content: string; userId?: string };
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required' });
  const client = await pool.connect();
  try {
    const now = Date.now();
    const upsert = await client.query(
      `INSERT INTO project_readmes (project_id, branch, content, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, branch)
       DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by
       RETURNING content, updated_at, updated_by`,
      [projectId, branch, content, now, userId ?? null]
    );
    return res.status(200).json(upsert.rows[0]);
  } catch (e) {
    console.error('updateReadme error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// GET /api/projects/:id/contributors
export const getContributors = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const client = await pool.connect();
  try {
    // Count snapshots per user in this project
    const result = await client.query(
      `SELECT u.id, u.name, u.email, COUNT(s.id) AS commits
       FROM snapshots s
       JOIN users u ON u.id = s.user_id
       WHERE s.project_id = $1
       GROUP BY u.id, u.name, u.email
       ORDER BY commits DESC`,
      [projectId]
    );
    return res.status(200).json(result.rows);
  } catch (e) {
    console.error('getContributors error', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

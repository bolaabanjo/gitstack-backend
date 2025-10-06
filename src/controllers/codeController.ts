// backend/src/controllers/codeController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';

let pool: Pool;
export const setDbPool = (dbPool: Pool) => { pool = dbPool; };

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
// Note: no file contents in DB yet; respond with metadata placeholder
export const getBlob = async (req: Request, res: Response) => {
  const { id: projectId } = req.params;
  const { branch, path = '' } = req.query as { branch?: string; path?: string };
  const client = await pool.connect();
  try {
    const snapshotId = await resolveSnapshotId(client, projectId, branch);
    if (!snapshotId) return res.status(404).json({ error: 'No snapshot for this branch/project' });

    const file = await client.query(
      `SELECT path, hash, size, mode FROM snapshot_files WHERE snapshot_id = $1 AND path = $2 LIMIT 1`,
      [snapshotId, path]
    );
    if (!file.rows.length) return res.status(404).json({ error: 'File not found' });

    // Placeholder: content storage not yet implemented
    return res.status(200).json({
      path: file.rows[0].path,
      hash: file.rows[0].hash,
      size: file.rows[0].size,
      mode: file.rows[0].mode,
      content: null,
      mime: null,
      message: 'File content not stored. Configure file storage to enable preview.',
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
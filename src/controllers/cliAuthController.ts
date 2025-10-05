// backend/src/controllers/cliAuthController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

let pool: Pool;

export const setDbPool = (dbPool: Pool) => {
  pool = dbPool;
};

// 1. CLI creates a new pending auth request
export const createCliAuthRequest = async (req: Request, res: Response) => {
  const { cliAuthToken, createdAt } = req.body;

  if (!cliAuthToken || !createdAt) {
    return res.status(400).json({ error: 'cliAuthToken and createdAt are required.' });
  }

  const client = await pool.connect();
  try {
    // Check if request already exists to prevent duplicates
    let result = await client.query(
      `SELECT id FROM cli_auth_requests WHERE cli_auth_token = $1`,
      [cliAuthToken]
    );

    if (result.rows.length > 0) {
      return res.status(200).json({ id: result.rows[0].id, message: 'Existing auth request found.' });
    }

    result = await client.query(
      `INSERT INTO cli_auth_requests (cli_auth_token, created_at, status)
       VALUES ($1, $2, 'pending')
       RETURNING id, cli_auth_token, status, created_at`,
      [cliAuthToken, createdAt]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating CLI auth request:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// 2. Web dashboard marks the request as completed
export const completeCliAuthRequest = async (req: Request, res: Response) => {
  const { cliAuthToken, clerkUserId, pgUserId, clerkSessionToken } = req.body;

  if (!cliAuthToken || !clerkUserId || !pgUserId || !clerkSessionToken) {
    return res.status(400).json({ error: 'cliAuthToken, clerkUserId, pgUserId, and clerkSessionToken are required.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `UPDATE cli_auth_requests
       SET status = 'completed',
           clerk_user_id = $1,
           convex_user_id = $2, -- Using convex_user_id column to store pgUserId
           clerk_session_token = $3,
           completed_at = $4
       WHERE cli_auth_token = $5 AND status = 'pending'
       RETURNING id, status, clerk_user_id, convex_user_id, clerk_session_token, completed_at`,
      [clerkUserId, pgUserId, clerkSessionToken, Date.now(), cliAuthToken]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pending auth request not found or already completed.' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error completing CLI auth request:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// 3. CLI polls this to check if the signup is done
export const getCliAuthRequestStatus = async (req: Request, res: Response) => {
  const { cliAuthToken } = req.query; // Expect cliAuthToken as a query parameter

  if (!cliAuthToken) {
    return res.status(400).json({ error: 'cliAuthToken is required.' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, status, clerk_user_id, convex_user_id AS pg_user_id, clerk_session_token, completed_at
       FROM cli_auth_requests
       WHERE cli_auth_token = $1`,
      [cliAuthToken]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ status: 'not_found', message: 'Auth request not found.' });
    }
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching CLI auth request status:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};
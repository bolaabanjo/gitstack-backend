// backend/src/controllers/userController.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';

// We'll pass the pool from server.ts to this controller
let pool: Pool;

export const setDbPool = (dbPool: Pool) => {
  pool = dbPool;
};

// Create a user in our DB if they don't exist, or return existing user's ID (PostgreSQL UUID)
export const createOrGetUser = async (req: Request, res: Response) => {
  const { clerkUserId, email, name } = req.body;

  if (!clerkUserId || !email) {
    return res.status(400).json({ error: 'clerkUserId and email are required.' });
  }

  const client = await pool.connect();
  try {
    // Check if user already exists based on clerk_user_id
    let result = await client.query(
      `SELECT id FROM users WHERE clerk_user_id = $1`,
      [clerkUserId]
    );

    let userId: string; // This will be the PostgreSQL UUID for the user

    if (result.rows.length > 0) {
      // User exists, return their internal PostgreSQL UUID
      userId = result.rows[0].id;
      // Optionally update last login time for existing users
      await client.query(
        `UPDATE users SET last_login_at = $1 WHERE id = $2`,
        [Date.now(), userId]
      );
    } else {
      // User does not exist, create a new one
      const now = Date.now(); // Milliseconds since epoch
      result = await client.query(
        `INSERT INTO users (clerk_user_id, email, name, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`, // Return the newly generated UUID
        [clerkUserId, email, name, now, now]
      );
      userId = result.rows[0].id;
    }

    // Return the internal PostgreSQL UUID
    res.status(200).json({ userId });
  } catch (error) {
    console.error('Error in createOrGetUser:', error);
    // Specifically check for unique constraint violation on clerk_user_id
    if (error instanceof Error && 'code' in error && error.code === '23505') {
      return res.status(409).json({ error: 'A user with this Clerk ID already exists.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
};

// Placeholder for other user-related operations if needed in the future
export const getUserProfile = async (req: Request, res: Response) => {
  res.status(501).json({ message: 'Not yet implemented.' });
};
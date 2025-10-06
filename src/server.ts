// backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import pg, { Pool } from 'pg';
import cors from 'cors';

import projectRoutes from './routes/projectRoutes';
import userRoutes from './routes/userRoutes';
import cliAuthRoutes from './routes/cliAuthRoutes';
import snapshotRoutes from './routes/snapshotRoutes';
import codeRoutes from './routes/codeRoutes';

import { setDbPool as setProjectDbPool } from './controllers/projectController';
import { setDbPool as setUserDbPool } from './controllers/userController';
import { setDbPool as setCliAuthDbPool } from './controllers/cliAuthController';
import { setDbPool as setSnapshotDbPool } from './controllers/snapshotController';
import { setDbPool as setCodeDbPool } from './controllers/codeController';

const app = express();
const port = process.env.PORT || '5000';
const host = '0.0.0.0';

// Parse INT8 as number
pg.types.setTypeParser(pg.types.builtins.INT8, (val: string) => parseInt(val, 10));

// Allowed origins
const allowedOrigins = process.env.FRONTEND_URLS
  ? process.env.FRONTEND_URLS.split(',').map((url) => url.trim())
  : ['http://localhost:3000'];

// CORS
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS: Origin ${origin} not allowed.`);
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// JSON parsing
app.use(express.json());

// Debug env logs
console.log('--- Backend Environment Variables ---');
console.log('PORT:', port);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '********' : 'NOT SET');
console.log('DB_PORT:', process.env.DB_PORT);
console.log('FRONTEND_URLS:', process.env.FRONTEND_URLS);
console.log('Allowed Origins (parsed):', allowedOrigins);
console.log('-----------------------------------');

// PG pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  ssl: { rejectUnauthorized: false },
});

async function startServer() {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT NOW()');
    console.log('Database connected successfully.');
  } catch (err) {
    console.error('CRITICAL ERROR: Failed to connect to database. Exiting.', err instanceof Error ? err.stack : err);
    process.exit(1);
  } finally {
    if (client) client.release();
  }

  // Inject pool into controllers
  setProjectDbPool(pool);
  setUserDbPool(pool);
  setCliAuthDbPool(pool);
  setSnapshotDbPool(pool);
  setCodeDbPool(pool);

  // Health root
  app.get('/', (_req, res) => {
    res.send('Hello from the Gitstack backend!');
  });

  // Routes
  app.use('/api/users', userRoutes);
  app.use('/api/projects', projectRoutes);   // CRUD + listing
  app.use('/api/cli-auth', cliAuthRoutes);
  app.use('/api/snapshots', snapshotRoutes);
  app.use('/api/projects', codeRoutes);      // /:id/branches, /:id/tree, etc.

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled Error:', err.stack);
    res.status(500).send('Something broke on the server!');
  });

  app.listen(parseInt(port, 10), host, () => {
    console.log(`Server running on port ${port} on host ${host}`);
  });
}

startServer();

process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await pool.end();
  console.log('Database connection pool closed.');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.stack);
});
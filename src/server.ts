// backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors'; // Import cors middleware

import projectRoutes from './routes/projectRoutes';
import userRoutes from './routes/userRoutes'; // NEW: Import user routes

import { setDbPool as setProjectDbPool } from './controllers/projectController'; // Renamed import
import { setDbPool as setUserDbPool } from './controllers/userController';     // NEW: Import and rename

const app = express();
const port = process.env.PORT || '5000';
const host = '0.0.0.0'; // Explicitly bind to all network interfaces for container environments

// Define allowed origins from an environment variable (comma-separated)
// Fallback to localhost for local development if FRONTEND_URLS is not set
const allowedOrigins = process.env.FRONTEND_URLS ?
  process.env.FRONTEND_URLS.split(',').map(url => url.trim()) :
  ['http://localhost:3000'];

// CORS configuration - UPDATED to handle multiple origins
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (like mobile apps, curl, or same-origin requests)
    // and requests from explicitly allowed origins.
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
app.use(cors(corsOptions)); // Use CORS middleware

// Middleware to parse JSON bodies
app.use(express.json());

// Log environment variables for debugging on Railway
console.log('--- Backend Environment Variables ---');
console.log('PORT:', port);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '********' : 'NOT SET'); // Mask password in logs
console.log('DB_PORT:', process.env.DB_PORT);
console.log('FRONTEND_URLS:', process.env.FRONTEND_URLS); // UPDATED log
console.log('Allowed Origins (parsed):', allowedOrigins); // NEW: log parsed origins for verification
console.log('-----------------------------------');

// Set up PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  ssl: {
    rejectUnauthorized: false
  }
});

// Centralized async startup function
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
    if (client) {
      client.release();
    }
  }

  // Pass the database pool to *both* controllers after successful connection
  setProjectDbPool(pool); // UPDATED: Use renamed import
  setUserDbPool(pool);     // NEW: Pass pool to user controller

  // Basic route
  app.get('/', (req, res) => {
    res.send('Hello from the Gitstack backend!');
  });

  // Use NEW user routes first, then project routes
  app.use('/api/users', userRoutes);   // NEW: Mount user routes
  app.use('/api/projects', projectRoutes);

  // Basic Error Handling Middleware (must be after all routes)
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled Error caught by middleware:', err.stack);
    res.status(500).send('Something broke on the server!');
  });

  // Start the server
  app.listen(parseInt(port, 10), host, () => {
    console.log(`Server running on port ${port} on host ${host}`);
  });
}

// Invoke the startup function
startServer();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await pool.end(); // Close the database connection pool
  console.log('Database connection pool closed.');
  process.exit(0);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Catch uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.stack);
});
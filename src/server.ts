// backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors'; // Import cors middleware
import projectRoutes from './routes/projectRoutes';
import { setDbPool } from './controllers/projectController';

const app = express();
// Ensure we explicitly use the PORT environment variable if set by the hosting platform
const port = process.env.PORT || '5000'; // Keep as string for process.env, parseInt later

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL, // This will be 'https://gitstack.xyz' in production
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
console.log('DB_PORT:', process.env.DB_PORT);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('-----------------------------------');

// Set up PostgreSQL connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  ssl: {
    rejectUnauthorized: false // Required for Supabase in some environments, adjust for production
  }
});

// Test database connection with async/await for better error handling
(async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    console.log('Database connected:', result.rows[0].now);
  } catch (err) {
    console.error('CRITICAL ERROR: Failed to connect to database', err instanceof Error ? err.stack : err);
    // Exit if we can't connect to the database, as the app won't function
    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
  }
})();

// Pass the database pool to the project controller
setDbPool(pool);

// Basic route
app.get('/', (req, res) => {
  res.send('Hello from the Gitstack backend!');
});

// Use project routes
app.use('/api/projects', projectRoutes);

// NEW: Basic Error Handling Middleware (must be after all routes)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled Error caught by middleware:', err.stack);
  res.status(500).send('Something broke on the server!');
});

// Start the server
app.listen(parseInt(port, 10), () => { // Parse port to integer here
  console.log(`Server running on port ${port}`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await pool.end(); // Close the database connection pool
  console.log('Database connection pool closed.');
  process.exit(0);
});

// NEW: Catch unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log the error, but don't exit the process immediately unless it's critical.
  // In production, you might want to send an alert.
});

// NEW: Catch uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error.stack);
  // This is a last resort. Always handle errors where they occur.
  // In production, consider graceful shutdown and process restart (e.g., with PM2).
});
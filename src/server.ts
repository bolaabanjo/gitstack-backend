// backend/src/server.ts
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import express from 'express';
import { Pool } from 'pg';
import projectRoutes from './routes/projectRoutes'; // Import our new project routes
import { setDbPool } from './controllers/projectController';

const app = express();
const port = process.env.PORT || 5000;

// Middleware to parse JSON bodies
app.use(express.json());

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

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  // IMPORTANT: Only proceed if client is defined (no error)
  if (client) { // <--- Added this check
    client.query('SELECT NOW()', (err, result) => {
      release(); // Release the client back to the pool
      if (err) {
        return console.error('Error executing query', err.stack);
      }
      console.log('Database connected:', result.rows[0].now);
    });
  }
});

setDbPool(pool);

// Basic route
app.get('/', (req, res) => {
  res.send('Hello from the Gitstack backend!');
});

app.use('/api/projects', projectRoutes); 

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  await pool.end(); // Close the database connection pool
  console.log('Database connection pool closed.');
  process.exit(0);
});
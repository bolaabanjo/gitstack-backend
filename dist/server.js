"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// backend/src/server.ts
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // Load environment variables from .env file
const express_1 = __importDefault(require("express"));
const pg_1 = require("pg");
const cors_1 = __importDefault(require("cors")); // Import cors middleware
const projectRoutes_1 = __importDefault(require("./routes/projectRoutes"));
const projectController_1 = require("./controllers/projectController");
const app = (0, express_1.default)();
const port = process.env.PORT || '5000'; // Keep as string for process.env, parseInt later
const host = '0.0.0.0'; // Explicitly bind to all network interfaces for container environments
// CORS configuration
const corsOptions = {
    origin: process.env.FRONTEND_URL, // This will be 'https://gitstack.xyz' in production
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
};
app.use((0, cors_1.default)(corsOptions)); // Use CORS middleware
// Middleware to parse JSON bodies
app.use(express_1.default.json());
// Log environment variables for debugging on Railway
console.log('--- Backend Environment Variables ---');
console.log('PORT:', port);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_PASSWORD:', process.env.DB_PASSWORD);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('-----------------------------------');
// Set up PostgreSQL connection pool
const pool = new pg_1.Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    ssl: {
        rejectUnauthorized: false // Required for Supabase in some environments, adjust for production
    }
});
// NEW: Centralized async startup function
async function startServer() {
    let client;
    try {
        // Attempt to connect and query to verify database is reachable
        client = await pool.connect();
        await client.query('SELECT NOW()');
        console.log('Database connected successfully.');
    }
    catch (err) {
        console.error('CRITICAL ERROR: Failed to connect to database. Exiting.', err instanceof Error ? err.stack : err);
        process.exit(1); // Exit if DB connection is critical for startup
    }
    finally {
        if (client) {
            client.release();
        }
    }
    // Pass the database pool to the project controller after successful connection
    (0, projectController_1.setDbPool)(pool);
    // Basic route
    app.get('/', (req, res) => {
        res.send('Hello from the Gitstack backend!');
    });
    // Use project routes
    app.use('/api/projects', projectRoutes_1.default);
    // Basic Error Handling Middleware (must be after all routes)
    app.use((err, req, res, next) => {
        console.error('Unhandled Error caught by middleware:', err.stack);
        res.status(500).send('Something broke on the server!');
    });
    // Start the server
    app.listen(parseInt(port, 10), host, () => {
        console.log(`Server running on port ${port} on host ${host}`); // Updated log
    });
}
// Invoke the startup function
startServer();
// Handle graceful shutdown (moved outside startServer for global scope)
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

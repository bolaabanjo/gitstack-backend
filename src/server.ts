// backend/src/server.ts
import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { Pool } from "pg";
import projectRoutes from "./routes/projectRoutes";
import { setDbPool } from "./controllers/projectController";

// -------------------------
// Environment Validation
// -------------------------
const requiredEnvVars = [
  "DB_USER",
  "DB_HOST",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_PORT",
  "FRONTEND_URL",
];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

// -------------------------
// App Setup
// -------------------------
const app = express();
const PORT = process.env.PORT ?? "5000";

// -------------------------
// Middleware
// -------------------------
app.use(express.json());

// CORS — allow only known origins
const allowedOrigins = [
  process.env.FRONTEND_URL, // primary domain
  "http://localhost:3000", // dev
  "https://gitstack.vercel.app", // optional preview
  "https://www.gitstack.xyz", // www variant
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// -------------------------
// Database Connection
// -------------------------
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || "5432", 10),
  ssl: { rejectUnauthorized: false },
});

// Test DB connection immediately on startup
(async () => {
  let client;
  try {
    client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    console.log(`✅ Database connected: ${result.rows[0].now}`);
  } catch (err) {
    console.error("CRITICAL: Failed to connect to database");
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  } finally {
    client?.release();
  }
})();

// Share pool with controllers
setDbPool(pool);

// -------------------------
// Routes
// -------------------------

// Health check — used by Railway, Vercel, or uptime monitors
app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Root route
app.get("/", (req: Request, res: Response) => {
  res.send("Gitstack Backend is running.");
});

// API routes
app.use("/api/projects", projectRoutes);

// -------------------------
// 404 Handler
// -------------------------
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    message: `The route ${req.originalUrl} does not exist.`,
  });
});

// -------------------------
// Global Error Handler
// -------------------------
app.use(
  (err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("🔥 Unhandled Error:", err.stack || err.message);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  }
);

// -------------------------
// Server Start
// -------------------------
app.listen(parseInt(PORT, 10), () => {
  console.log("===================================");
  console.log(`Gitstack backend running on port ${PORT}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`Connected to database: ${process.env.DB_NAME}`);
  console.log("===================================");
});

// -------------------------
// Graceful Shutdown
// -------------------------
process.on("SIGINT", async () => {
  console.log("\nShutting down server...");
  await pool.end();
  console.log("Database pool closed. Goodbye!");
  process.exit(0);
});

// Catch unhandled rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

// Catch uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error.stack || error.message);
});

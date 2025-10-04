-- SQL DDL for Gitstack Database Schema

-- Enable uuid-ossp for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id VARCHAR(255) UNIQUE NOT NULL, -- Indexed by clerkUserId
    email VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    created_at BIGINT NOT NULL, -- Milliseconds since epoch
    last_login_at BIGINT         -- Milliseconds since epoch
);

-- Index for users table
CREATE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users (clerk_user_id);


-- 2. CLI Auth Requests Table
CREATE TABLE IF NOT EXISTS cli_auth_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cli_auth_token VARCHAR(255) UNIQUE NOT NULL, -- Indexed by cliAuthToken
    status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    created_at BIGINT NOT NULL,                  -- Milliseconds since epoch
    completed_at BIGINT,                         -- Milliseconds since epoch
    clerk_session_token VARCHAR(255),
    clerk_user_id VARCHAR(255),                  -- Clerk's user ID for this request
    convex_user_id UUID,                         -- Foreign key to users.id (was Convex's v.id("users"))
    CONSTRAINT fk_cli_auth_requests_user FOREIGN KEY (convex_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for cli_auth_requests table
CREATE INDEX IF NOT EXISTS idx_cli_auth_requests_cli_auth_token ON cli_auth_requests (cli_auth_token);


-- 3. Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(50) NOT NULL CHECK (visibility IN ('public', 'private')),
    created_at BIGINT NOT NULL,                  -- Milliseconds since epoch
    updated_at BIGINT NOT NULL,                  -- Milliseconds since epoch
    owner_id UUID NOT NULL,                      -- Foreign key to users.id
    stats_snapshots INTEGER DEFAULT 0 NOT NULL,  -- Denormalized stats
    stats_deployments INTEGER DEFAULT 0 NOT NULL,
    stats_last_deployed BIGINT,                  -- Milliseconds since epoch

    CONSTRAINT fk_projects_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for projects table
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects (owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_name ON projects (name); -- For searchField: "name" (consider full-text search later if needed)


-- 4. Snapshots Table
CREATE TABLE IF NOT EXISTS snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL,                    -- Foreign key to projects.id
    user_id UUID NOT NULL,                       -- Foreign key to users.id (Convex user id)
    title VARCHAR(255),
    timestamp BIGINT NOT NULL,                   -- Milliseconds since epoch
    file_count INTEGER NOT NULL,
    description TEXT,
    external_id VARCHAR(255),                    -- e.g., a hash or external reference

    CONSTRAINT fk_snapshots_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT fk_snapshots_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indexes for snapshots table
CREATE INDEX IF NOT EXISTS idx_snapshots_project_id ON snapshots (project_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_id ON snapshots (user_id);


-- 5. Snapshot Files Table
CREATE TABLE IF NOT EXISTS snapshot_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID NOT NULL,                   -- Foreign key to snapshots.id
    path VARCHAR(1024) NOT NULL,                 -- File path (can be long)
    hash VARCHAR(255),
    size BIGINT,                                 -- File size in bytes
    mode INTEGER,                                -- File mode (e.g., permissions)

    CONSTRAINT fk_snapshot_files_snapshot FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

-- Index for snapshot_files table
CREATE INDEX IF NOT EXISTS idx_snapshot_files_snapshot_id ON snapshot_files (snapshot_id);
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE Users (
    username VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    is_contributor BOOLEAN DEFAULT FALSE,
    is_shadowed BOOLEAN DEFAULT FALSE,
    has_verified BOOLEAN DEFAULT FALSE,
    is_trusted_dev BOOLEAN DEFAULT FALSE,
    is_2fa_enabled BOOLEAN DEFAULT FALSE,
    is_bot BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_bot_roles CHECK (NOT (is_bot = true AND (is_admin = true OR is_contributor = true)))
);

CREATE TABLE AuthTokens (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) REFERENCES Users(username) ON DELETE CASCADE,
    token_type VARCHAR(50) NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ChangeBatches (
    id SERIAL PRIMARY KEY,
    author_id VARCHAR(255) REFERENCES Users(username),
    description TEXT,
    merged_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE TemplateGroups (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    default_template_id INT
);

CREATE TABLE Templates (
    id SERIAL PRIMARY KEY,
    author_id VARCHAR(255) REFERENCES Users(username),
    group_id INT REFERENCES TemplateGroups(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    original_id INT REFERENCES Templates(id) ON DELETE SET NULL,
    change_batch_id INT REFERENCES ChangeBatches(id) ON DELETE CASCADE,
    is_approved BOOLEAN DEFAULT TRUE,
    approved_roles TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE TemplateGroups ADD CONSTRAINT fk_default_template FOREIGN KEY (default_template_id) REFERENCES Templates(id) ON DELETE SET NULL;

CREATE TABLE Content (
    id SERIAL PRIMARY KEY,
    author_id VARCHAR(255) REFERENCES Users(username),
    payload JSONB NOT NULL,
    live_date TIMESTAMP WITH TIME ZONE,
    is_visible BOOLEAN DEFAULT TRUE,
    headers TEXT,
    original_id INT REFERENCES Content(id) ON DELETE SET NULL,
    change_batch_id INT REFERENCES ChangeBatches(id) ON DELETE CASCADE,
    approved_roles TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ContentTemplateGroups (
    content_id INT REFERENCES Content(id) ON DELETE CASCADE,
    group_id INT REFERENCES TemplateGroups(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, group_id)
);

CREATE TABLE Tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE TemplateTags (
    template_id INT REFERENCES Templates(id) ON DELETE CASCADE,
    tag_id INT REFERENCES Tags(id) ON DELETE CASCADE,
    PRIMARY KEY (template_id, tag_id)
);

CREATE TABLE ContentTags (
    content_id INT REFERENCES Content(id) ON DELETE CASCADE,
    tag_id INT REFERENCES Tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
);

CREATE TABLE Handlers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    author_id VARCHAR(255) REFERENCES Users(username),
    is_approved BOOLEAN DEFAULT TRUE,
    original_id INT REFERENCES Handlers(id) ON DELETE SET NULL,
    change_batch_id INT REFERENCES ChangeBatches(id) ON DELETE CASCADE,
    approved_roles TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_handlers_name ON Handlers (name) WHERE is_approved = true AND change_batch_id IS NULL;

CREATE TABLE TemplateHandlers (
    template_id INT REFERENCES Templates(id) ON DELETE CASCADE,
    handler_id INT REFERENCES Handlers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (template_id, handler_id)
);

CREATE TABLE ContentHandlers (
    content_id INT REFERENCES Content(id) ON DELETE CASCADE,
    handler_id INT REFERENCES Handlers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (content_id, handler_id)
);

CREATE TABLE Components (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    author_id VARCHAR(255) REFERENCES Users(username),
    original_id INT REFERENCES Components(id) ON DELETE SET NULL,
    change_batch_id INT REFERENCES ChangeBatches(id) ON DELETE CASCADE,
    is_approved BOOLEAN DEFAULT TRUE,
    approved_roles TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_components_name ON Components (name) WHERE is_approved = true AND change_batch_id IS NULL;

CREATE TABLE TemplateComponents (
    template_id INT REFERENCES Templates(id) ON DELETE CASCADE,
    component_id INT REFERENCES Components(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (template_id, component_id)
);

CREATE TABLE ContentComponents (
    content_id INT REFERENCES Content(id) ON DELETE CASCADE,
    component_id INT REFERENCES Components(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (content_id, component_id)
);

CREATE TABLE ComponentHandlers (
    component_id INT REFERENCES Components(id) ON DELETE CASCADE,
    handler_id INT REFERENCES Handlers(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (component_id, handler_id)
);

CREATE TABLE SiteSettings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

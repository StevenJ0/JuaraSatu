-- GTNIC 2026 / Campaign Lab
-- Migration: Business Memory (RAG) + multiple scheduled campaign captions
-- Depends on: 20261030210000_initial_schema.sql (17-table baseline)
--
-- Scope:
--   1) Knowledge documents, with private business memory and global guides.
--   2) Vector chunks (768 dimensions) for tenant-safe semantic retrieval.
--   3) An authenticated, ownership-checked similarity-search RPC.
--   4) Optional task linkage on campaign_contents, allowing separate captions
--      for each scheduled activity in the same channel across multiple days.
--
-- Not included: automatic embedding workers, data backfills, actual Gemini
-- calls, automatic posting, payment/order mutations, or remote deployment.
--
-- Use a NEW migration. Do not paste into or modify the initial migration.

BEGIN;

-- ============================================================================
-- 1. pgvector: use Supabase's extensions schema for extension-owned objects.
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- If vector was already installed in a different schema, stop instead of
-- silently writing ambiguous types or operators into this migration.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_extension AS e
          JOIN pg_namespace AS n ON n.oid = e.extnamespace
         WHERE e.extname = 'vector' AND n.nspname <> 'extensions'
    ) THEN
        RAISE EXCEPTION
          'pgvector is installed outside extensions schema; review its schema before applying this migration';
    END IF;
END;
$$;

-- ============================================================================
-- 2. Knowledge documents: immutable references to the source + content version
--    Global marketing guides: scope=global / business_id NULL.
--    Private campaign memory: scope=business / business_id NOT NULL.
-- ============================================================================
CREATE TABLE public.knowledge_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT,
    scope varchar(16) NOT NULL
        CHECK (scope IN ('global', 'business')),
    source_type varchar(24) NOT NULL
        CHECK (source_type IN ('marketing_guide', 'campaign_memory')),
    source_campaign_id uuid,
    source_url text,
    title varchar(180) NOT NULL CHECK (length(btrim(title)) > 0),
    content text NOT NULL CHECK (length(btrim(content)) > 0),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    content_hash char(64) NOT NULL
        CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    content_version integer NOT NULL DEFAULT 1
        CHECK (content_version > 0),
    embedding_status varchar(16) NOT NULL DEFAULT 'pending'
        CHECK (embedding_status IN ('pending', 'ready', 'failed')),
    embedding_error_code varchar(80),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_documents_scope_valid CHECK (
        (scope = 'global' AND business_id IS NULL) OR
        (scope = 'business' AND business_id IS NOT NULL)
    ),
    CONSTRAINT knowledge_documents_source_valid CHECK (
        (source_type = 'campaign_memory' AND scope = 'business'
            AND source_campaign_id IS NOT NULL) OR
        (source_type = 'marketing_guide' AND source_campaign_id IS NULL)
    ),
    CONSTRAINT knowledge_documents_source_campaign_same_business_fk
        FOREIGN KEY (source_campaign_id, business_id)
        REFERENCES public.campaigns(id, business_id) ON DELETE RESTRICT
);

-- One current memory document per campaign; revisions update the document's
-- content, increment content_version and set embedding_status='pending'.
CREATE UNIQUE INDEX knowledge_documents_campaign_memory_uniq
    ON public.knowledge_documents(source_campaign_id)
    WHERE source_type = 'campaign_memory';
CREATE INDEX knowledge_documents_business_source_idx
    ON public.knowledge_documents(business_id, source_type, updated_at DESC);
CREATE INDEX knowledge_documents_global_guides_idx
    ON public.knowledge_documents(source_type, updated_at DESC)
    WHERE scope = 'global';

CREATE TRIGGER knowledge_documents_updated_at
    BEFORE UPDATE ON public.knowledge_documents
    FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

-- ============================================================================
-- 3. Embedded document chunks
--    version must match the CURRENT document version to be retrievable.
--    A document must also be marked ready, keeping stale vectors out of RAG.
-- ============================================================================
CREATE TABLE public.knowledge_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL
        REFERENCES public.knowledge_documents(id) ON DELETE CASCADE,
    content_version integer NOT NULL CHECK (content_version > 0),
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    content text NOT NULL CHECK (length(btrim(content)) > 0),
    embedding extensions.vector(768) NOT NULL,
    embedding_model varchar(100) NOT NULL
        CHECK (length(btrim(embedding_model)) > 0),
    embedded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT knowledge_chunks_document_version_index_uniq
        UNIQUE (document_id, content_version, chunk_index)
);
CREATE INDEX knowledge_chunks_document_idx
    ON public.knowledge_chunks(document_id, content_version);
CREATE INDEX knowledge_chunks_embedding_model_idx
    ON public.knowledge_chunks(embedding_model);

-- pgvector HNSW approximate nearest-neighbor index, cosine distance.
-- Filter by business/scope and embedding_model in retrieval queries.
CREATE INDEX knowledge_chunks_embedding_hnsw_idx
    ON public.knowledge_chunks
    USING hnsw (embedding extensions.vector_cosine_ops);

-- ============================================================================
-- 4. Security: same model as the 17-table baseline.
--    No direct writes from browser. Authenticated users can read own/private
--    memory and global guides; anon gets no access. Server writes require an
--    explicit authentication/tenant check BEFORE using elevated credentials.
-- ============================================================================
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_documents_accessible_read
    ON public.knowledge_documents
    FOR SELECT TO authenticated
    USING (
        scope = 'global'
        OR (scope = 'business' AND public.is_business_owner(business_id))
    );

CREATE POLICY knowledge_chunks_accessible_read
    ON public.knowledge_chunks
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.knowledge_documents AS d
             WHERE d.id = document_id
               AND (
                   d.scope = 'global'
                   OR (d.scope = 'business'
                       AND public.is_business_owner(d.business_id))
               )
        )
    );

REVOKE ALL ON TABLE
    public.knowledge_documents, public.knowledge_chunks
FROM anon, authenticated;
GRANT SELECT ON TABLE
    public.knowledge_documents, public.knowledge_chunks
TO authenticated;

-- ============================================================================
-- 5. Owner-scoped RAG retrieval for an authenticated user's business.
--    SECURITY INVOKER means normal RLS still applies to both tables.
--    The owner check prevents querying a business belonging to someone else.
--    Provide query embeddings generated with the same model/dimensions.
--    Cosine distance operator is explicitly schema-qualified because
--    this function sets search_path to an empty string for security.
-- ============================================================================
CREATE FUNCTION public.match_campaign_knowledge(
    target_business_id uuid,
    query_embedding extensions.vector(768),
    embedding_model_name text,
    match_limit integer DEFAULT 5,
    min_similarity double precision DEFAULT 0.5,
    include_global boolean DEFAULT true
)
RETURNS TABLE (
    document_id uuid,
    chunk_id uuid,
    source_type varchar(24),
    source_campaign_id uuid,
    title varchar(180),
    content text,
    metadata jsonb,
    similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        d.id AS document_id,
        c.id AS chunk_id,
        d.source_type,
        d.source_campaign_id,
        d.title,
        c.content,
        d.metadata,
        1.0 - (c.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
    FROM public.knowledge_chunks AS c
    JOIN public.knowledge_documents AS d ON d.id = c.document_id
    WHERE public.is_business_owner(target_business_id)
      AND (
          (d.scope = 'business' AND d.business_id = target_business_id)
          OR (include_global AND d.scope = 'global')
      )
      AND d.embedding_status = 'ready'
      AND c.content_version = d.content_version
      AND c.embedding_model = embedding_model_name
      AND 1.0 - (c.embedding OPERATOR(extensions.<=>) query_embedding)
          >= GREATEST(0.0, LEAST(1.0, min_similarity))
    ORDER BY c.embedding OPERATOR(extensions.<=>) query_embedding, c.id
    LIMIT LEAST(GREATEST(match_limit, 1), 20);
$$;

REVOKE ALL ON FUNCTION public.match_campaign_knowledge(
    uuid, extensions.vector, text, integer, double precision, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_campaign_knowledge(
    uuid, extensions.vector, text, integer, double precision, boolean
) TO authenticated;

-- ============================================================================
-- 6. Multi-day campaign calendar: task-specific caption/content.
--
-- Baseline allowed only ONE (channel, content_type) per campaign, so a six-day
-- Instagram/WhatsApp plan could not have different captions on separate days.
-- Keep campaign-level landing-page copy (campaign_task_id IS NULL), and allow
-- one content item per task/channel/type when linked to a campaign task.
-- Existing content rows remain campaign-level; no data is deleted.
-- ============================================================================
ALTER TABLE public.campaign_tasks
    ADD CONSTRAINT campaign_tasks_id_business_campaign_uniq
    UNIQUE (id, business_id, campaign_id);

ALTER TABLE public.campaign_contents
    ADD COLUMN campaign_task_id uuid;

ALTER TABLE public.campaign_contents
    ADD CONSTRAINT campaign_contents_task_campaign_business_fk
    FOREIGN KEY (campaign_task_id, business_id, campaign_id)
    REFERENCES public.campaign_tasks(id, business_id, campaign_id)
    ON DELETE RESTRICT;

ALTER TABLE public.campaign_contents
    DROP CONSTRAINT campaign_contents_campaign_channel_type_uniq;

CREATE UNIQUE INDEX campaign_contents_campaign_level_uniq
    ON public.campaign_contents(campaign_id, channel, content_type)
    WHERE campaign_task_id IS NULL;

CREATE UNIQUE INDEX campaign_contents_task_level_uniq
    ON public.campaign_contents(campaign_task_id, channel, content_type)
    WHERE campaign_task_id IS NOT NULL;

CREATE INDEX campaign_contents_task_idx
    ON public.campaign_contents(campaign_task_id)
    WHERE campaign_task_id IS NOT NULL;

COMMIT;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      ai_generations: {
        Row: {
          business_id: string
          campaign_id: string | null
          created_at: string
          error_code: string | null
          finished_at: string | null
          generation_type: string
          id: string
          input_hash: string
          model_id: string
          output_json: Json | null
          preorder_id: string | null
          request_key: string
          session_id: string | null
          started_at: string | null
          status: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          campaign_id?: string | null
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          generation_type: string
          id?: string
          input_hash: string
          model_id: string
          output_json?: Json | null
          preorder_id?: string | null
          request_key: string
          session_id?: string | null
          started_at?: string | null
          status: string
        }
        Update: {
          business_id?: string
          campaign_id?: string | null
          created_at?: string
          error_code?: string | null
          finished_at?: string | null
          generation_type?: string
          id?: string
          input_hash?: string
          model_id?: string
          output_json?: Json | null
          preorder_id?: string | null
          request_key?: string
          session_id?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_campaign_id_business_id_preorder_id_fkey"
            columns: ["campaign_id", "business_id", "preorder_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id", "preorder_id"]
          },
          {
            foreignKeyName: "ai_generations_preorder_id_business_id_fkey"
            columns: ["preorder_id", "business_id"]
            isOneToOne: false
            referencedRelation: "preorders"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "ai_generations_session_id_business_id_preorder_id_fkey"
            columns: ["session_id", "business_id", "preorder_id"]
            isOneToOne: false
            referencedRelation: "campaign_ai_sessions"
            referencedColumns: ["id", "business_id", "preorder_id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          categories: string[]
          category: string
          created_at: string
          description: string | null
          id: string
          is_demo: boolean
          name: string
          pickup_instructions: string
          public_contact: string | null
          slug: string
          timezone: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          categories: string[]
          category: string
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name: string
          pickup_instructions: string
          public_contact?: string | null
          slug: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          categories?: string[]
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          pickup_instructions?: string
          public_contact?: string | null
          slug?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaign_ai_messages: {
        Row: {
          ai_generation_id: string | null
          body_text: string
          business_id: string
          context_hash: string | null
          created_at: string
          id: string
          proposal_json: Json | null
          role: string
          sequence: number
          session_id: string
        }
        ComputedFields: never
        Insert: {
          ai_generation_id?: string | null
          body_text: string
          business_id: string
          context_hash?: string | null
          created_at?: string
          id?: string
          proposal_json?: Json | null
          role: string
          sequence: number
          session_id: string
        }
        Update: {
          ai_generation_id?: string | null
          body_text?: string
          business_id?: string
          context_hash?: string | null
          created_at?: string
          id?: string
          proposal_json?: Json | null
          role?: string
          sequence?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_ai_messages_ai_generation_id_business_id_session__fkey"
            columns: ["ai_generation_id", "business_id", "session_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id", "business_id", "session_id"]
          },
          {
            foreignKeyName: "campaign_ai_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_ai_messages_session_id_business_id_fkey"
            columns: ["session_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaign_ai_sessions"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaign_ai_sessions: {
        Row: {
          business_id: string
          campaign_id: string | null
          context_version_hash: string
          created_at: string
          id: string
          preorder_id: string
          status: string
          summary_text: string | null
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          business_id: string
          campaign_id?: string | null
          context_version_hash: string
          created_at?: string
          id?: string
          preorder_id: string
          status: string
          summary_text?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          business_id?: string
          campaign_id?: string | null
          context_version_hash?: string
          created_at?: string
          id?: string
          preorder_id?: string
          status?: string
          summary_text?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_ai_sessions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_ai_sessions_campaign_id_business_id_preorder_id_fkey"
            columns: ["campaign_id", "business_id", "preorder_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id", "preorder_id"]
          },
          {
            foreignKeyName: "campaign_ai_sessions_preorder_id_business_id_fkey"
            columns: ["preorder_id", "business_id"]
            isOneToOne: false
            referencedRelation: "preorders"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaign_blueprints: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by_user_id: string | null
          blueprint_json: NonNullable<Json>
          business_id: string
          campaign_id: string
          context_hash: string
          created_at: string
          id: string
          source_ai_generation_id: string | null
          version: number
        }
        ComputedFields: never
        Insert: {
          approval_status: string
          approved_at?: string | null
          approved_by_user_id?: string | null
          blueprint_json: NonNullable<Json>
          business_id: string
          campaign_id: string
          context_hash: string
          created_at?: string
          id?: string
          source_ai_generation_id?: string | null
          version: number
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by_user_id?: string | null
          blueprint_json?: NonNullable<Json>
          business_id?: string
          campaign_id?: string
          context_hash?: string
          created_at?: string
          id?: string
          source_ai_generation_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_blueprints_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_blueprints_campaign_id_business_id_fkey"
            columns: ["campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "campaign_blueprints_source_ai_generation_id_business_id_fkey"
            columns: ["source_ai_generation_id", "business_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaign_contents: {
        Row: {
          blueprint_id: string
          body: string
          business_id: string
          campaign_id: string
          channel: string
          content_key: string
          content_type: string
          created_at: string
          id: string
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          blueprint_id: string
          body: string
          business_id: string
          campaign_id: string
          channel: string
          content_key: string
          content_type: string
          created_at?: string
          id?: string
          updated_at?: string
          version?: number
        }
        Update: {
          blueprint_id?: string
          body?: string
          business_id?: string
          campaign_id?: string
          channel?: string
          content_key?: string
          content_type?: string
          created_at?: string
          id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_contents_blueprint_id_business_id_campaign_id_fkey"
            columns: ["blueprint_id", "business_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_blueprints"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
          {
            foreignKeyName: "campaign_contents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_contents_campaign_id_business_id_fkey"
            columns: ["campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaign_costs: {
        Row: {
          amount_idr: number
          business_id: string
          campaign_id: string
          category: string
          created_at: string
          description: string | null
          id: string
          incurred_at: string
          updated_at: string
          version: number
          void_reason: string | null
          voided_at: string | null
        }
        ComputedFields: never
        Insert: {
          amount_idr: number
          business_id: string
          campaign_id: string
          category: string
          created_at?: string
          description?: string | null
          id?: string
          incurred_at: string
          updated_at?: string
          version?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Update: {
          amount_idr?: number
          business_id?: string
          campaign_id?: string
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          incurred_at?: string
          updated_at?: string
          version?: number
          void_reason?: string | null
          voided_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_costs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_costs_campaign_id_business_id_fkey"
            columns: ["campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaign_evaluations: {
        Row: {
          analysis_json: Json | null
          blueprint_id: string
          business_id: string
          calculated_at: string
          campaign_id: string
          created_at: string
          evaluated_at: string
          evaluation_kind: string
          id: string
          limitations_json: NonNullable<Json>
          metrics_json: NonNullable<Json>
          metrics_schema_version: number
          source_ai_generation_id: string | null
        }
        ComputedFields: never
        Insert: {
          analysis_json?: Json | null
          blueprint_id: string
          business_id: string
          calculated_at: string
          campaign_id: string
          created_at?: string
          evaluated_at: string
          evaluation_kind: string
          id?: string
          limitations_json: NonNullable<Json>
          metrics_json: NonNullable<Json>
          metrics_schema_version: number
          source_ai_generation_id?: string | null
        }
        Update: {
          analysis_json?: Json | null
          blueprint_id?: string
          business_id?: string
          calculated_at?: string
          campaign_id?: string
          created_at?: string
          evaluated_at?: string
          evaluation_kind?: string
          id?: string
          limitations_json?: NonNullable<Json>
          metrics_json?: NonNullable<Json>
          metrics_schema_version?: number
          source_ai_generation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_evaluations_blueprint_id_business_id_campaign_id_fkey"
            columns: ["blueprint_id", "business_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_blueprints"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
          {
            foreignKeyName: "campaign_evaluations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_evaluations_campaign_id_business_id_fkey"
            columns: ["campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "campaign_evaluations_source_ai_generation_id_business_id_fkey"
            columns: ["source_ai_generation_id", "business_id"]
            isOneToOne: false
            referencedRelation: "ai_generations"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaign_memories: {
        Row: {
          approved_at: string | null
          business_id: string
          campaign_id: string
          content_hash: string
          created_at: string
          embedding: string | null
          embedding_model: string | null
          embedding_profile: string | null
          embedding_status: string
          embedding_version: number
          id: string
          indexed_at: string | null
          lessons_json: NonNullable<Json>
          limitations_json: NonNullable<Json>
          review_status: string
          source_blueprint_id: string | null
          source_evaluation_id: string
          source_version: number
          summary_text: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          approved_at?: string | null
          business_id: string
          campaign_id: string
          content_hash: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_profile?: string | null
          embedding_status: string
          embedding_version: number
          id?: string
          indexed_at?: string | null
          lessons_json: NonNullable<Json>
          limitations_json: NonNullable<Json>
          review_status: string
          source_blueprint_id?: string | null
          source_evaluation_id: string
          source_version: number
          summary_text: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          business_id?: string
          campaign_id?: string
          content_hash?: string
          created_at?: string
          embedding?: string | null
          embedding_model?: string | null
          embedding_profile?: string | null
          embedding_status?: string
          embedding_version?: number
          id?: string
          indexed_at?: string | null
          lessons_json?: NonNullable<Json>
          limitations_json?: NonNullable<Json>
          review_status?: string
          source_blueprint_id?: string | null
          source_evaluation_id?: string
          source_version?: number
          summary_text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_memories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_memories_campaign_id_business_id_fkey"
            columns: ["campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "campaign_memories_source_blueprint_id_business_id_campaign_fkey"
            columns: ["source_blueprint_id", "business_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_blueprints"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
          {
            foreignKeyName: "campaign_memories_source_evaluation_id_business_id_campaig_fkey"
            columns: ["source_evaluation_id", "business_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_evaluations"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
        ]
      }
      campaign_tasks: {
        Row: {
          blueprint_id: string
          business_id: string
          campaign_id: string
          channel: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_at: string
          id: string
          task_key: string
          title: string
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          blueprint_id: string
          business_id: string
          campaign_id: string
          channel?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at: string
          id?: string
          task_key: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          blueprint_id?: string
          business_id?: string
          campaign_id?: string
          channel?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_at?: string
          id?: string
          task_key?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_tasks_blueprint_id_business_id_campaign_id_fkey"
            columns: ["blueprint_id", "business_id", "campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_blueprints"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
          {
            foreignKeyName: "campaign_tasks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_tasks_campaign_id_business_id_fkey"
            columns: ["campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      campaigns: {
        Row: {
          active_blueprint_id: string | null
          baseline_calculated_at: string | null
          baseline_json: Json | null
          budget_cap_idr: number
          business_id: string
          closed_at: string | null
          completed_at: string | null
          costs_completeness: string
          created_at: string
          discount_bps: number
          ends_at: string
          id: string
          marketing_approach: string
          metrics_schema_version: number | null
          name: string
          offer_type: string
          preorder_id: string
          primary_kpi: string
          published_at: string | null
          published_blueprint_id: string | null
          slug: string | null
          starts_at: string
          status: string
          target_additional_units: number
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          active_blueprint_id?: string | null
          baseline_calculated_at?: string | null
          baseline_json?: Json | null
          budget_cap_idr: number
          business_id: string
          closed_at?: string | null
          completed_at?: string | null
          costs_completeness: string
          created_at?: string
          discount_bps?: number
          ends_at: string
          id?: string
          marketing_approach: string
          metrics_schema_version?: number | null
          name: string
          offer_type: string
          preorder_id: string
          primary_kpi: string
          published_at?: string | null
          published_blueprint_id?: string | null
          slug?: string | null
          starts_at: string
          status: string
          target_additional_units: number
          updated_at?: string
          version?: number
        }
        Update: {
          active_blueprint_id?: string | null
          baseline_calculated_at?: string | null
          baseline_json?: Json | null
          budget_cap_idr?: number
          business_id?: string
          closed_at?: string | null
          completed_at?: string | null
          costs_completeness?: string
          created_at?: string
          discount_bps?: number
          ends_at?: string
          id?: string
          marketing_approach?: string
          metrics_schema_version?: number | null
          name?: string
          offer_type?: string
          preorder_id?: string
          primary_kpi?: string
          published_at?: string | null
          published_blueprint_id?: string | null
          slug?: string | null
          starts_at?: string
          status?: string
          target_additional_units?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_active_blueprint_id_business_id_id_fkey"
            columns: ["active_blueprint_id", "business_id", "id"]
            isOneToOne: false
            referencedRelation: "campaign_blueprints"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
          {
            foreignKeyName: "campaigns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_preorder_id_business_id_fkey"
            columns: ["preorder_id", "business_id"]
            isOneToOne: false
            referencedRelation: "preorders"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "campaigns_published_blueprint_id_business_id_id_fkey"
            columns: ["published_blueprint_id", "business_id", "id"]
            isOneToOne: false
            referencedRelation: "campaign_blueprints"
            referencedColumns: ["id", "business_id", "campaign_id"]
          },
        ]
      }
      capacity_reservations: {
        Row: {
          business_id: string
          capacity_id: string
          created_at: string
          expires_at: string | null
          id: string
          order_id: string
          order_item_id: string
          preorder_item_id: string | null
          quantity: number
          release_reason: string | null
          released_at: string | null
          state: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          capacity_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          order_id: string
          order_item_id: string
          preorder_item_id?: string | null
          quantity: number
          release_reason?: string | null
          released_at?: string | null
          state: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          capacity_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          order_id?: string
          order_item_id?: string
          preorder_item_id?: string | null
          quantity?: number
          release_reason?: string | null
          released_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "capacity_reservations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacity_reservations_capacity_id_business_id_fkey"
            columns: ["capacity_id", "business_id"]
            isOneToOne: false
            referencedRelation: "production_capacity"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "capacity_reservations_order_id_business_id_fkey"
            columns: ["order_id", "business_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "capacity_reservations_order_item_id_business_id_order_id_fkey"
            columns: ["order_item_id", "business_id", "order_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "business_id", "order_id"]
          },
          {
            foreignKeyName: "capacity_reservations_preorder_item_id_business_id_fkey"
            columns: ["preorder_item_id", "business_id"]
            isOneToOne: false
            referencedRelation: "preorder_items"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      domain_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          business_id: string | null
          command_key: string | null
          entity_id: string
          entity_type: string
          event_type: string
          id: string
          occurred_at: string
          safe_details_json: Json | null
        }
        ComputedFields: never
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          business_id?: string | null
          command_key?: string | null
          entity_id: string
          entity_type: string
          event_type: string
          id?: string
          occurred_at?: string
          safe_details_json?: Json | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string | null
          command_key?: string | null
          entity_id?: string
          entity_type?: string
          event_type?: string
          id?: string
          occurred_at?: string
          safe_details_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "domain_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          attempt_count: number
          business_id: string | null
          created_at: string
          dedupe_key: string
          entity_id: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error_code: string | null
          locked_until: string | null
          next_run_at: string
          provider_reference: string | null
          status: string
        }
        ComputedFields: never
        Insert: {
          attempt_count?: number
          business_id?: string | null
          created_at?: string
          dedupe_key: string
          entity_id?: string | null
          finished_at?: string | null
          id?: string
          job_type: string
          last_error_code?: string | null
          locked_until?: string | null
          next_run_at?: string
          provider_reference?: string | null
          status?: string
        }
        Update: {
          attempt_count?: number
          business_id?: string | null
          created_at?: string
          dedupe_key?: string
          entity_id?: string | null
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error_code?: string | null
          locked_until?: string | null
          next_run_at?: string
          provider_reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          business_id: string
          command_key: string | null
          details_json: Json | null
          event_type: string
          from_state: string | null
          id: string
          occurred_at: string
          order_id: string
          to_state: string | null
        }
        ComputedFields: never
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          business_id: string
          command_key?: string | null
          details_json?: Json | null
          event_type: string
          from_state?: string | null
          id?: string
          occurred_at?: string
          order_id: string
          to_state?: string | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          business_id?: string
          command_key?: string | null
          details_json?: Json | null
          event_type?: string
          from_state?: string | null
          id?: string
          occurred_at?: string
          order_id?: string
          to_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_order_id_business_id_fkey"
            columns: ["order_id", "business_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      order_items: {
        Row: {
          base_unit_price_idr: number
          business_id: string
          cost_quality_snapshot: string
          created_at: string
          discount_bps_snapshot: number
          discount_per_unit_idr: number
          final_unit_price_idr: number
          id: string
          line_total_idr: number
          order_id: string
          preorder_item_id: string | null
          pricing_campaign_id: string | null
          product_id: string
          product_name_snapshot: string
          quantity: number
          sku_snapshot: string
          variable_cost_per_unit_idr: number | null
        }
        ComputedFields: never
        Insert: {
          base_unit_price_idr: number
          business_id: string
          cost_quality_snapshot: string
          created_at?: string
          discount_bps_snapshot: number
          discount_per_unit_idr: number
          final_unit_price_idr: number
          id?: string
          line_total_idr: number
          order_id: string
          preorder_item_id?: string | null
          pricing_campaign_id?: string | null
          product_id: string
          product_name_snapshot: string
          quantity: number
          sku_snapshot: string
          variable_cost_per_unit_idr?: number | null
        }
        Update: {
          base_unit_price_idr?: number
          business_id?: string
          cost_quality_snapshot?: string
          created_at?: string
          discount_bps_snapshot?: number
          discount_per_unit_idr?: number
          final_unit_price_idr?: number
          id?: string
          line_total_idr?: number
          order_id?: string
          preorder_item_id?: string | null
          pricing_campaign_id?: string | null
          product_id?: string
          product_name_snapshot?: string
          quantity?: number
          sku_snapshot?: string
          variable_cost_per_unit_idr?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_business_id_fkey"
            columns: ["order_id", "business_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "order_items_preorder_item_id_business_id_product_id_fkey"
            columns: ["preorder_item_id", "business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "preorder_items"
            referencedColumns: ["id", "business_id", "product_id"]
          },
          {
            foreignKeyName: "order_items_pricing_campaign_id_business_id_fkey"
            columns: ["pricing_campaign_id", "business_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "order_items_product_id_business_id_fkey"
            columns: ["product_id", "business_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      order_production_costs: {
        Row: {
          amount_idr: number | null
          business_id: string
          cost_kind: string
          cost_per_unit_idr: number | null
          created_at: string
          id: string
          incurred_at: string
          order_item_id: string
          quality: string
          quantity: number
          resolution_note: string | null
          resolved_by_user_id: string | null
        }
        ComputedFields: never
        Insert: {
          amount_idr?: number | null
          business_id: string
          cost_kind: string
          cost_per_unit_idr?: number | null
          created_at?: string
          id?: string
          incurred_at: string
          order_item_id: string
          quality: string
          quantity: number
          resolution_note?: string | null
          resolved_by_user_id?: string | null
        }
        Update: {
          amount_idr?: number | null
          business_id?: string
          cost_kind?: string
          cost_per_unit_idr?: number | null
          created_at?: string
          id?: string
          incurred_at?: string
          order_item_id?: string
          quality?: string
          quantity?: number
          resolution_note?: string | null
          resolved_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_production_costs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_production_costs_order_item_id_business_id_fkey"
            columns: ["order_item_id", "business_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      orders: {
        Row: {
          attribution_campaign_id: string | null
          business_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          customer_contact: string | null
          customer_email: string | null
          customer_name: string
          discount_total_idr: number
          external_payment_confirmed_at: string | null
          external_payment_status: string | null
          fulfilled_at: string | null
          fulfillment_date: string
          fulfillment_status: string
          id: string
          idempotency_key: string | null
          order_status: string
          payment_due_at: string | null
          payment_mode: string
          preorder_id: string | null
          pricing_campaign_id: string | null
          private_token_hash: string | null
          production_started_at: string | null
          public_order_number: string
          ready_at: string | null
          request_hash: string | null
          review_reason: string | null
          source: string
          subtotal_idr: number
          total_idr: number
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          attribution_campaign_id?: string | null
          business_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          customer_contact?: string | null
          customer_email?: string | null
          customer_name: string
          discount_total_idr: number
          external_payment_confirmed_at?: string | null
          external_payment_status?: string | null
          fulfilled_at?: string | null
          fulfillment_date: string
          fulfillment_status: string
          id?: string
          idempotency_key?: string | null
          order_status: string
          payment_due_at?: string | null
          payment_mode: string
          preorder_id?: string | null
          pricing_campaign_id?: string | null
          private_token_hash?: string | null
          production_started_at?: string | null
          public_order_number: string
          ready_at?: string | null
          request_hash?: string | null
          review_reason?: string | null
          source: string
          subtotal_idr: number
          total_idr: number
          updated_at?: string
          version?: number
        }
        Update: {
          attribution_campaign_id?: string | null
          business_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          customer_contact?: string | null
          customer_email?: string | null
          customer_name?: string
          discount_total_idr?: number
          external_payment_confirmed_at?: string | null
          external_payment_status?: string | null
          fulfilled_at?: string | null
          fulfillment_date?: string
          fulfillment_status?: string
          id?: string
          idempotency_key?: string | null
          order_status?: string
          payment_due_at?: string | null
          payment_mode?: string
          preorder_id?: string | null
          pricing_campaign_id?: string | null
          private_token_hash?: string | null
          production_started_at?: string | null
          public_order_number?: string
          ready_at?: string | null
          request_hash?: string | null
          review_reason?: string | null
          source?: string
          subtotal_idr?: number
          total_idr?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "orders_attribution_campaign_id_business_id_preorder_id_fkey"
            columns: ["attribution_campaign_id", "business_id", "preorder_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id", "preorder_id"]
          },
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_preorder_id_business_id_fkey"
            columns: ["preorder_id", "business_id"]
            isOneToOne: false
            referencedRelation: "preorders"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "orders_pricing_campaign_id_business_id_preorder_id_fkey"
            columns: ["pricing_campaign_id", "business_id", "preorder_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id", "business_id", "preorder_id"]
          },
        ]
      }
      payment_events: {
        Row: {
          business_id: string
          created_at: string
          id: string
          outcome: string
          payload_hash: string
          payment_id: string
          processed_at: string | null
          provider_event_key: string
          provider_status: string
          signature_valid: boolean
          verified_at: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          outcome: string
          payload_hash: string
          payment_id: string
          processed_at?: string | null
          provider_event_key: string
          provider_status: string
          signature_valid: boolean
          verified_at: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          outcome?: string
          payload_hash?: string
          payment_id?: string
          processed_at?: string | null
          provider_event_key?: string
          provider_status?: string
          signature_valid?: boolean
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_events_payment_id_business_id_fkey"
            columns: ["payment_id", "business_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_idr: number
          applied_at: string | null
          attempt_number: number
          business_id: string
          created_at: string
          id: string
          is_active_attempt: boolean
          order_id: string
          provider: string
          provider_order_id: string
          provider_paid_at: string | null
          provider_transaction_id: string | null
          qr_content: string | null
          qr_expires_at: string | null
          review_reason: string | null
          status: string
          updated_at: string
          verified_at: string | null
          version: number
        }
        ComputedFields: never
        Insert: {
          amount_idr: number
          applied_at?: string | null
          attempt_number: number
          business_id: string
          created_at?: string
          id?: string
          is_active_attempt: boolean
          order_id: string
          provider?: string
          provider_order_id: string
          provider_paid_at?: string | null
          provider_transaction_id?: string | null
          qr_content?: string | null
          qr_expires_at?: string | null
          review_reason?: string | null
          status: string
          updated_at?: string
          verified_at?: string | null
          version?: number
        }
        Update: {
          amount_idr?: number
          applied_at?: string | null
          attempt_number?: number
          business_id?: string
          created_at?: string
          id?: string
          is_active_attempt?: boolean
          order_id?: string
          provider?: string
          provider_order_id?: string
          provider_paid_at?: string | null
          provider_transaction_id?: string | null
          qr_content?: string | null
          qr_expires_at?: string | null
          review_reason?: string | null
          status?: string
          updated_at?: string
          verified_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_business_id_fkey"
            columns: ["order_id", "business_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      preorder_items: {
        Row: {
          base_price_snapshot_idr: number
          business_id: string
          capacity_id: string
          created_at: string
          id: string
          preorder_id: string
          product_id: string
          product_name_snapshot: string
          quota_units: number
          sku_snapshot: string
          target_units: number
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          base_price_snapshot_idr: number
          business_id: string
          capacity_id: string
          created_at?: string
          id?: string
          preorder_id: string
          product_id: string
          product_name_snapshot: string
          quota_units: number
          sku_snapshot: string
          target_units: number
          updated_at?: string
          version?: number
        }
        Update: {
          base_price_snapshot_idr?: number
          business_id?: string
          capacity_id?: string
          created_at?: string
          id?: string
          preorder_id?: string
          product_id?: string
          product_name_snapshot?: string
          quota_units?: number
          sku_snapshot?: string
          target_units?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "preorder_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preorder_items_capacity_id_business_id_product_id_fkey"
            columns: ["capacity_id", "business_id", "product_id"]
            isOneToOne: false
            referencedRelation: "production_capacity"
            referencedColumns: ["id", "business_id", "product_id"]
          },
          {
            foreignKeyName: "preorder_items_preorder_id_business_id_fkey"
            columns: ["preorder_id", "business_id"]
            isOneToOne: false
            referencedRelation: "preorders"
            referencedColumns: ["id", "business_id"]
          },
          {
            foreignKeyName: "preorder_items_product_id_business_id_fkey"
            columns: ["product_id", "business_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      preorders: {
        Row: {
          business_id: string
          closed_at: string | null
          completed_at: string | null
          created_at: string
          ends_at: string
          fulfillment_date: string
          id: string
          name: string
          pickup_terms_snapshot: Json | null
          published_at: string | null
          slug: string | null
          starts_at: string
          status: string
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          business_id: string
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          ends_at: string
          fulfillment_date: string
          id?: string
          name: string
          pickup_terms_snapshot?: Json | null
          published_at?: string | null
          slug?: string | null
          starts_at: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          ends_at?: string
          fulfillment_date?: string
          id?: string
          name?: string
          pickup_terms_snapshot?: Json | null
          published_at?: string | null
          slug?: string | null
          starts_at?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "preorders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      production_capacity: {
        Row: {
          business_id: string
          created_at: string
          fulfillment_date: string
          fulfillment_window_end_at: string
          id: string
          intake_cutoff_at: string
          product_id: string
          total_units: number
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          fulfillment_date: string
          fulfillment_window_end_at: string
          id?: string
          intake_cutoff_at: string
          product_id: string
          total_units: number
          updated_at?: string
          version?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          fulfillment_date?: string
          fulfillment_window_end_at?: string
          id?: string
          intake_cutoff_at?: string
          product_id?: string
          total_units?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "production_capacity_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "production_capacity_product_id_business_id_fkey"
            columns: ["product_id", "business_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id", "business_id"]
          },
        ]
      }
      products: {
        Row: {
          base_price_idr: number
          business_id: string
          cost_quality: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          photo_path: string | null
          sku: string
          updated_at: string
          variable_cost_idr: number | null
          version: number
        }
        ComputedFields: never
        Insert: {
          base_price_idr: number
          business_id: string
          cost_quality: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          photo_path?: string | null
          sku: string
          updated_at?: string
          variable_cost_idr?: number | null
          version?: number
        }
        Update: {
          base_price_idr?: number
          business_id?: string
          cost_quality?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          photo_path?: string | null
          sku?: string
          updated_at?: string
          variable_cost_idr?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_buckets: {
        Row: {
          bucket_key_hash: string
          count: number
          expires_at: string
          window_start: string
        }
        ComputedFields: never
        Insert: {
          bucket_key_hash: string
          count: number
          expires_at: string
          window_start: string
        }
        Update: {
          bucket_key_hash?: string
          count?: number
          expires_at?: string
          window_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_late_payment: {
        Args: {
          p_expected_version: number
          p_order_id: string
          p_payment_id: string
        }
        Returns: undefined
      }
      admit_ai_generation: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_context_hash: string
          p_daily_limit: number
          p_day_key_hash: string
          p_expected_version: number
          p_generation_id: string
          p_generation_type: string
          p_hour_key_hash: string
          p_input_hash: string
          p_message: string
          p_minute_key_hash: string
          p_model_id: string
          p_preorder_id: string
          p_request_key: string
          p_session_id: string
        }
        Returns: Json
      }
      advance_fulfillment: {
        Args: {
          p_action: string
          p_expected_version: number
          p_order_id: string
        }
        Returns: undefined
      }
      apply_verified_payment:
        | {
            Args: {
              p_amount_idr: number
              p_event_key: string
              p_payload_hash: string
              p_payment_id: string
              p_provider_order_id: string
              p_provider_paid_at: string
              p_provider_status: string
            }
            Returns: string
          }
        | {
            Args: {
              p_amount_idr: number
              p_payload_hash: string
              p_provider_event_key: string
              p_provider_order_id: string
              p_provider_paid_at: string
              p_provider_status: string
              p_provider_transaction_id: string
            }
            Returns: Json
          }
      approve_blueprint: {
        Args: {
          p_actor_user_id: string
          p_blueprint_id: string
          p_business_id: string
          p_context_hash: string
          p_expected_versions: Json
        }
        Returns: {
          approval_status: string
          approved_at: string | null
          approved_by_user_id: string | null
          blueprint_json: NonNullable<Json>
          business_id: string
          campaign_id: string
          context_hash: string
          created_at: string
          id: string
          source_ai_generation_id: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaign_blueprints"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_campaign_memory: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_content_hash: string
          p_memory_id: string
          p_model: string
          p_profile: string
        }
        Returns: string
      }
      cancel_preorder_draft: {
        Args: { p_expected_version: number; p_preorder_id: string }
        Returns: undefined
      }
      cancel_published_preorder: {
        Args: { p_expected_version: number; p_preorder_id: string }
        Returns: undefined
      }
      claim_ai_generation: {
        Args: {
          p_actor_user_id?: string
          p_business_id: string
          p_context_hash: string
          p_expected_version: number
          p_generation_type?: string
          p_input_hash: string
          p_message: string
          p_model_id: string
          p_request_key: string
          p_session_id: string
        }
        Returns: Json
      }
      claim_jobs:
        | {
            Args: {
              p_job_types: string[]
              p_lease_seconds: number
              p_limit: number
            }
            Returns: Json
          }
        | {
            Args: {
              p_lease_seconds?: number
              p_limit?: number
              p_max_attempts?: number
            }
            Returns: {
              attempt_count: number
              business_id: string | null
              created_at: string
              dedupe_key: string
              entity_id: string | null
              finished_at: string | null
              id: string
              job_type: string
              last_error_code: string | null
              locked_until: string | null
              next_run_at: string
              provider_reference: string | null
              status: string
            }[]
            SetofOptions: {
              from: "*"
              to: "job_runs"
              isOneToOne: false
              isSetofReturn: true
            }
          }
      claim_memory_jobs: {
        Args: {
          p_business_id: string
          p_embedding_version: number
          p_lease_seconds?: number
          p_limit?: number
          p_max_attempts?: number
          p_model: string
          p_profile: string
        }
        Returns: {
          attempt_count: number
          business_id: string | null
          created_at: string
          dedupe_key: string
          entity_id: string | null
          finished_at: string | null
          id: string
          job_type: string
          last_error_code: string | null
          locked_until: string | null
          next_run_at: string
          provider_reference: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_runs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_payment_attempt: { Args: { p_token_hash: string }; Returns: Json }
      close_campaign: {
        Args: {
          p_actor_user_id?: string
          p_business_id: string
          p_campaign_id: string
          p_expected_version: number
        }
        Returns: {
          active_blueprint_id: string | null
          baseline_calculated_at: string | null
          baseline_json: Json | null
          budget_cap_idr: number
          business_id: string
          closed_at: string | null
          completed_at: string | null
          costs_completeness: string
          created_at: string
          discount_bps: number
          ends_at: string
          id: string
          marketing_approach: string
          metrics_schema_version: number | null
          name: string
          offer_type: string
          preorder_id: string
          primary_kpi: string
          published_at: string | null
          published_blueprint_id: string | null
          slug: string | null
          starts_at: string
          status: string
          target_additional_units: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_preorder: {
        Args: {
          p_expected_version: number
          p_preorder_id: string
          p_reason?: string
        }
        Returns: undefined
      }
      complete_job: {
        Args: {
          p_attempt: number
          p_job_id: string
          p_provider_reference?: string
        }
        Returns: boolean
      }
      complete_memory_index_job: {
        Args: {
          p_attempt_count: number
          p_business_id: string
          p_content_hash: string
          p_embedding?: string
          p_embedding_version: number
          p_error_code?: string
          p_job_id: string
          p_max_attempts?: number
          p_memory_id: string
          p_model: string
          p_profile: string
        }
        Returns: undefined
      }
      complete_memory_indexing: {
        Args: {
          p_content_hash: string
          p_embedding: string
          p_embedding_version: number
          p_memory_id: string
          p_model: string
          p_profile: string
        }
        Returns: undefined
      }
      complete_preorder: {
        Args: { p_expected_version: number; p_preorder_id: string }
        Returns: undefined
      }
      create_ai_session: {
        Args: {
          p_actor_user_id?: string
          p_business_id: string
          p_context_hash: string
          p_preorder_id: string
          p_session_id: string
        }
        Returns: {
          business_id: string
          campaign_id: string | null
          context_version_hash: string
          created_at: string
          id: string
          preorder_id: string
          status: string
          summary_text: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaign_ai_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_business_with_owner:
        | {
            Args: {
              p_categories: string[]
              p_description: string
              p_name: string
              p_pickup_instructions: string
              p_public_contact: string
              p_slug: string
            }
            Returns: string
          }
        | {
            Args: {
              p_actor_user_id?: string
              p_category: string
              p_name: string
              p_pickup_instructions: string
              p_slug: string
            }
            Returns: string
          }
      create_campaign_with_initial_blueprint: {
        Args: {
          p_actor_user_id: string
          p_blueprint_id: string
          p_blueprint_json: Json
          p_business_id: string
          p_campaign_id: string
          p_context_hash: string
          p_draft: Json
          p_expected_source_versions: Json
          p_preorder_id: string
          p_source_generation_id: string
        }
        Returns: {
          approval_status: string
          approved_at: string | null
          approved_by_user_id: string | null
          blueprint_json: NonNullable<Json>
          business_id: string
          campaign_id: string
          context_hash: string
          created_at: string
          id: string
          source_ai_generation_id: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaign_blueprints"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_manual_order: {
        Args: {
          p_customer_contact: string
          p_customer_email: string
          p_customer_name: string
          p_idempotency_key: string
          p_is_paid: boolean
          p_preorder_id: string
          p_quantity: number
          p_request_hash: string
        }
        Returns: Json
      }
      create_preorder_order: {
        Args: {
          p_attribution_ref?: string
          p_customer_contact: string
          p_customer_email: string
          p_customer_name: string
          p_expected_unit_price_idr: number
          p_hold_ttl_seconds: number
          p_idempotency_key: string
          p_quantity: number
          p_request_hash: string
          p_slug: string
          p_token_hash: string
        }
        Returns: Json
      }
      create_standalone_manual_order: {
        Args: {
          p_capacity_id: string
          p_customer_contact: string
          p_customer_email: string
          p_customer_name: string
          p_idempotency_key: string
          p_is_paid: boolean
          p_quantity: number
          p_request_hash: string
        }
        Returns: Json
      }
      decline_late_payment: {
        Args: { p_expected_version: number; p_note: string; p_order_id: string }
        Returns: undefined
      }
      enqueue_expire_jobs: { Args: { p_limit: number }; Returns: number }
      expire_or_cancel_order: {
        Args: {
          p_action: string
          p_expected_version: number
          p_order_id: string
          p_reason: string
          p_refund_note?: string
        }
        Returns: undefined
      }
      fail_ai_generation: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_claim_version: number
          p_error_code: string
          p_generation_id: string
          p_session_id: string
        }
        Returns: Json
      }
      fail_job: {
        Args: {
          p_attempt: number
          p_error_code: string
          p_job_id: string
          p_provider_reference?: string
        }
        Returns: string
      }
      finalize_ai_generation: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_claim_version: number
          p_generation_id: string
          p_output_json: Json
          p_session_id: string
        }
        Returns: Json
      }
      finalize_campaign_evaluation: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_campaign_id: string
          p_evaluation_id: string
          p_expected_campaign_version: number
          p_expected_context_hash: string
          p_mode: string
          p_preorder_id: string
          p_request_id: string
        }
        Returns: string
      }
      finish_job: {
        Args: {
          p_attempt_count: number
          p_error_code?: string
          p_job_id: string
          p_provider_reference?: string
          p_success: boolean
        }
        Returns: undefined
      }
      is_business_owner: {
        Args: { target_business_id: string }
        Returns: boolean
      }
      match_campaign_memories: {
        Args: {
          p_business_id: string
          p_embedding: string
          p_embedding_version: number
          p_limit?: number
          p_min_similarity?: number
          p_model: string
          p_profile: string
        }
        Returns: {
          campaign_id: string
          lessons_json: Json
          limitations_json: Json
          memory_id: string
          similarity: number
          source_evaluation_id: string
          summary_text: string
        }[]
      }
      publish_campaign: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_campaign_id: string
          p_expected_versions: Json
        }
        Returns: {
          active_blueprint_id: string | null
          baseline_calculated_at: string | null
          baseline_json: Json | null
          budget_cap_idr: number
          business_id: string
          closed_at: string | null
          completed_at: string | null
          costs_completeness: string
          created_at: string
          discount_bps: number
          ends_at: string
          id: string
          marketing_approach: string
          metrics_schema_version: number | null
          name: string
          offer_type: string
          preorder_id: string
          primary_kpi: string
          published_at: string | null
          published_blueprint_id: string | null
          slug: string | null
          starts_at: string
          status: string
          target_additional_units: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      publish_preorder:
        | {
            Args: {
              p_actor_user_id?: string
              p_business_id: string
              p_expected_version: number
              p_preorder_id: string
            }
            Returns: {
              business_id: string
              closed_at: string | null
              completed_at: string | null
              created_at: string
              ends_at: string
              fulfillment_date: string
              id: string
              name: string
              pickup_terms_snapshot: Json | null
              published_at: string | null
              slug: string | null
              starts_at: string
              status: string
              updated_at: string
              version: number
            }
            SetofOptions: {
              from: "*"
              to: "preorders"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { p_expected_version: number; p_preorder_id: string }
            Returns: undefined
          }
      read_preorder_offer: { Args: { p_preorder_id: string }; Returns: Json }
      record_campaign_evaluation: {
        Args: {
          p_actor_user_id: string
          p_analysis: Json
          p_blueprint_id: string
          p_business_id: string
          p_calculated_at: string
          p_campaign_id: string
          p_evaluation_id: string
          p_kind: string
          p_limitations: Json
          p_metrics: Json
        }
        Returns: string
      }
      record_campaign_evaluation_cas: {
        Args: {
          p_actor_user_id: string
          p_analysis: Json
          p_blueprint_id: string
          p_business_id: string
          p_calculated_at: string
          p_campaign_id: string
          p_evaluation_id: string
          p_expected_evaluation_id: string
          p_limitations: Json
          p_metrics: Json
        }
        Returns: string
      }
      record_payment_charge: {
        Args: {
          p_payment_id: string
          p_provider_transaction_id: string
          p_qr_content: string
          p_qr_expires_at: string
        }
        Returns: boolean
      }
      refresh_ai_session_context: {
        Args: {
          p_actor_user_id?: string
          p_business_id: string
          p_context_hash: string
          p_expected_version: number
          p_session_id: string
        }
        Returns: {
          business_id: string
          campaign_id: string | null
          context_version_hash: string
          created_at: string
          id: string
          preorder_id: string
          status: string
          summary_text: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaign_ai_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_production_cost: {
        Args: {
          p_cost_per_unit_idr: number
          p_expected_version: number
          p_note: string
          p_order_id: string
          p_quality: string
        }
        Returns: undefined
      }
      save_blueprint_revision: {
        Args: {
          p_actor_user_id: string
          p_blueprint_id: string
          p_blueprint_json: Json
          p_business_id: string
          p_campaign_id: string
          p_context_hash: string
          p_expected_campaign_version: number
          p_source_generation_id: string
        }
        Returns: {
          approval_status: string
          approved_at: string | null
          approved_by_user_id: string | null
          blueprint_json: NonNullable<Json>
          business_id: string
          campaign_id: string
          context_hash: string
          created_at: string
          id: string
          source_ai_generation_id: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaign_blueprints"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_campaign_draft: {
        Args: {
          p_actor_user_id: string
          p_business_id: string
          p_campaign_id: string
          p_draft: Json
          p_expected_version: number
          p_preorder_id: string
        }
        Returns: {
          active_blueprint_id: string | null
          baseline_calculated_at: string | null
          baseline_json: Json | null
          budget_cap_idr: number
          business_id: string
          closed_at: string | null
          completed_at: string | null
          costs_completeness: string
          created_at: string
          discount_bps: number
          ends_at: string
          id: string
          marketing_approach: string
          metrics_schema_version: number | null
          name: string
          offer_type: string
          preorder_id: string
          primary_kpi: string
          published_at: string | null
          published_blueprint_id: string | null
          slug: string | null
          starts_at: string
          status: string
          target_additional_units: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "campaigns"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_preorder_draft: {
        Args: {
          p_capacity_id: string
          p_ends_at: string
          p_expected_version: number
          p_name: string
          p_preorder_id: string
          p_quota_units: number
          p_slug: string
          p_starts_at: string
          p_target_units: number
        }
        Returns: string
      }
      take_rate_limit: {
        Args: {
          p_expires_at: string
          p_key_hash: string
          p_limit: number
          p_window_start: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

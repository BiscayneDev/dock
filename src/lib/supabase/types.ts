export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          telegram_id: number
          telegram_username: string | null
          name: string | null
          timezone: string
          quiet_hours_start: string | null
          quiet_hours_end: string | null
          daily_briefing: boolean
          created_at: string
        }
        Insert: {
          id?: string
          telegram_id: number
          telegram_username?: string | null
          name?: string | null
          timezone?: string
          quiet_hours_start?: string | null
          quiet_hours_end?: string | null
          daily_briefing?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          telegram_id?: number
          telegram_username?: string | null
          name?: string | null
          timezone?: string
          quiet_hours_start?: string | null
          quiet_hours_end?: string | null
          daily_briefing?: boolean
          created_at?: string
        }
      }
      oauth_tokens: {
        Row: {
          id: string
          user_id: string
          provider: string
          access_token: string
          refresh_token: string | null
          expires_at: string | null
          scopes: string[] | null
          provider_account_id: string | null
          provider_account_email: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          provider: string
          access_token: string
          refresh_token?: string | null
          expires_at?: string | null
          scopes?: string[] | null
          provider_account_id?: string | null
          provider_account_email?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          provider?: string
          access_token?: string
          refresh_token?: string | null
          expires_at?: string | null
          scopes?: string[] | null
          provider_account_id?: string | null
          provider_account_email?: string | null
          created_at?: string
          updated_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          user_id: string
          role: string
          content: string | null
          tool_calls: unknown | null
          tool_results: unknown | null
          telegram_message_id: number | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          role: string
          content?: string | null
          tool_calls?: unknown | null
          tool_results?: unknown | null
          telegram_message_id?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          role?: string
          content?: string | null
          tool_calls?: unknown | null
          tool_results?: unknown | null
          telegram_message_id?: number | null
          created_at?: string
        }
      }
      reminders: {
        Row: {
          id: string
          user_id: string
          message: string
          fire_at: string
          fired: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          message: string
          fire_at: string
          fired?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          message?: string
          fire_at?: string
          fired?: boolean
          created_at?: string
        }
      }
      recipes: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string | null
          instructions: string
          trigger_type: string
          trigger_config: unknown
          enabled: boolean
          notify_on_run: boolean
          last_run_at: string | null
          last_checked_at: string | null
          run_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string | null
          instructions: string
          trigger_type: string
          trigger_config: unknown
          enabled?: boolean
          notify_on_run?: boolean
          last_run_at?: string | null
          last_checked_at?: string | null
          run_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          description?: string | null
          instructions?: string
          trigger_type?: string
          trigger_config?: unknown
          enabled?: boolean
          notify_on_run?: boolean
          last_run_at?: string | null
          last_checked_at?: string | null
          run_count?: number
          created_at?: string
          updated_at?: string
        }
      }
      recipe_runs: {
        Row: {
          id: string
          recipe_id: string
          user_id: string
          triggered_at: string
          completed_at: string | null
          trigger_context: unknown | null
          status: string
          output: string | null
          tool_calls: unknown | null
          error: string | null
          duration_ms: number | null
        }
        Insert: {
          id?: string
          recipe_id: string
          user_id: string
          triggered_at?: string
          completed_at?: string | null
          trigger_context?: unknown | null
          status?: string
          output?: string | null
          tool_calls?: unknown | null
          error?: string | null
          duration_ms?: number | null
        }
        Update: {
          id?: string
          recipe_id?: string
          user_id?: string
          triggered_at?: string
          completed_at?: string | null
          trigger_context?: unknown | null
          status?: string
          output?: string | null
          tool_calls?: unknown | null
          error?: string | null
          duration_ms?: number | null
        }
      }
      recipe_templates: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          category: string | null
          required_integrations: string[] | null
          trigger_type: string
          trigger_config: unknown
          instructions: string
          preview_output: string | null
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          category?: string | null
          required_integrations?: string[] | null
          trigger_type: string
          trigger_config: unknown
          instructions: string
          preview_output?: string | null
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          category?: string | null
          required_integrations?: string[] | null
          trigger_type?: string
          trigger_config?: unknown
          instructions?: string
          preview_output?: string | null
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_visible: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_visible?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_visible?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      challenge_play_grants: {
        Row: {
          challenge_id: string
          created_at: string
          id: string
          plays: number
          reference: string
          source: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          id?: string
          plays?: number
          reference: string
          source: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          id?: string
          plays?: number
          reference?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_play_grants_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_play_state: {
        Row: {
          challenge_id: string
          created_at: string
          id: string
          last_play_at: string | null
          plays_used: number
          updated_at: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          created_at?: string
          id?: string
          last_play_at?: string | null
          plays_used?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          created_at?: string
          id?: string
          last_play_at?: string | null
          plays_used?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_play_state_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_sessions: {
        Row: {
          challenge_id: string
          completed_at: string | null
          created_at: string
          id: string
          score: number
          seed: string | null
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          challenge_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          score?: number
          seed?: string | null
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          challenge_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          score?: number
          seed?: string | null
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_sessions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_settings: {
        Row: {
          auto_cleanup_enabled: boolean
          created_at: string
          id: string
          is_enabled: boolean
          ticker_duration_seconds: number
          ticker_enabled: boolean
          ticker_max_winners: number
          updated_at: string
          winner_retention_days: number
        }
        Insert: {
          auto_cleanup_enabled?: boolean
          created_at?: string
          id?: string
          is_enabled?: boolean
          ticker_duration_seconds?: number
          ticker_enabled?: boolean
          ticker_max_winners?: number
          updated_at?: string
          winner_retention_days?: number
        }
        Update: {
          auto_cleanup_enabled?: boolean
          created_at?: string
          id?: string
          is_enabled?: boolean
          ticker_duration_seconds?: number
          ticker_enabled?: boolean
          ticker_max_winners?: number
          updated_at?: string
          winner_retention_days?: number
        }
        Relationships: []
      }
      challenge_winners: {
        Row: {
          challenge_id: string
          claim_status: string
          coupon_code: string | null
          id: string
          is_hidden: boolean
          result: Json
          reward_name: string
          reward_quantity: number
          reward_type: string
          session_id: string | null
          user_id: string
          won_at: string
        }
        Insert: {
          challenge_id: string
          claim_status?: string
          coupon_code?: string | null
          id?: string
          is_hidden?: boolean
          result?: Json
          reward_name: string
          reward_quantity?: number
          reward_type: string
          session_id?: string | null
          user_id: string
          won_at?: string
        }
        Update: {
          challenge_id?: string
          claim_status?: string
          coupon_code?: string | null
          id?: string
          is_hidden?: boolean
          result?: Json
          reward_name?: string
          reward_quantity?: number
          reward_type?: string
          session_id?: string | null
          user_id?: string
          won_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_winners_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_winners_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "challenge_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      challenges: {
        Row: {
          attempts_per_session: number
          banner_path: string | null
          base_plays: number
          cooldown_minutes: number
          created_at: string
          daily_end_time: string | null
          daily_start_time: string | null
          daily_winner_limit: number
          description: string | null
          detector_type: string
          difficulty: string
          difficulty_config: Json
          ends_on: string | null
          game_type: string
          icon_emoji: string
          id: string
          instructions: string | null
          max_plays_per_customer: number
          max_stored_plays: number
          max_wins_per_customer: number
          name: string
          order_min_amount: number
          order_required_status: string
          order_unlock_enabled: boolean
          order_unlock_max: number
          order_unlock_plays: number
          order_unlock_stack: boolean
          referral_cooldown_hours: number
          referral_required_count: number
          referral_unlock_enabled: boolean
          referral_unlock_max: number
          referral_unlock_plays: number
          referral_verification: string
          refill_amount: number
          refill_enabled: boolean
          refill_interval_minutes: number
          required_accuracy: number | null
          required_score: number
          reward_coupon_id: string | null
          reward_name: string
          reward_points: number
          reward_quantity: number
          reward_type: string
          rules_config: Json
          slug: string
          sort_order: number
          starts_on: string | null
          status: string
          time_limit_seconds: number | null
          total_winner_limit: number
          updated_at: string
          winning_condition: Json
        }
        Insert: {
          attempts_per_session?: number
          banner_path?: string | null
          base_plays?: number
          cooldown_minutes?: number
          created_at?: string
          daily_end_time?: string | null
          daily_start_time?: string | null
          daily_winner_limit?: number
          description?: string | null
          detector_type: string
          difficulty?: string
          difficulty_config?: Json
          ends_on?: string | null
          game_type: string
          icon_emoji?: string
          id?: string
          instructions?: string | null
          max_plays_per_customer?: number
          max_stored_plays?: number
          max_wins_per_customer?: number
          name: string
          order_min_amount?: number
          order_required_status?: string
          order_unlock_enabled?: boolean
          order_unlock_max?: number
          order_unlock_plays?: number
          order_unlock_stack?: boolean
          referral_cooldown_hours?: number
          referral_required_count?: number
          referral_unlock_enabled?: boolean
          referral_unlock_max?: number
          referral_unlock_plays?: number
          referral_verification?: string
          refill_amount?: number
          refill_enabled?: boolean
          refill_interval_minutes?: number
          required_accuracy?: number | null
          required_score?: number
          reward_coupon_id?: string | null
          reward_name?: string
          reward_points?: number
          reward_quantity?: number
          reward_type?: string
          rules_config?: Json
          slug: string
          sort_order?: number
          starts_on?: string | null
          status?: string
          time_limit_seconds?: number | null
          total_winner_limit?: number
          updated_at?: string
          winning_condition?: Json
        }
        Update: {
          attempts_per_session?: number
          banner_path?: string | null
          base_plays?: number
          cooldown_minutes?: number
          created_at?: string
          daily_end_time?: string | null
          daily_start_time?: string | null
          daily_winner_limit?: number
          description?: string | null
          detector_type?: string
          difficulty?: string
          difficulty_config?: Json
          ends_on?: string | null
          game_type?: string
          icon_emoji?: string
          id?: string
          instructions?: string | null
          max_plays_per_customer?: number
          max_stored_plays?: number
          max_wins_per_customer?: number
          name?: string
          order_min_amount?: number
          order_required_status?: string
          order_unlock_enabled?: boolean
          order_unlock_max?: number
          order_unlock_plays?: number
          order_unlock_stack?: boolean
          referral_cooldown_hours?: number
          referral_required_count?: number
          referral_unlock_enabled?: boolean
          referral_unlock_max?: number
          referral_unlock_plays?: number
          referral_verification?: string
          refill_amount?: number
          refill_enabled?: boolean
          refill_interval_minutes?: number
          required_accuracy?: number | null
          required_score?: number
          reward_coupon_id?: string | null
          reward_name?: string
          reward_points?: number
          reward_quantity?: number
          reward_type?: string
          rules_config?: Json
          slug?: string
          sort_order?: number
          starts_on?: string | null
          status?: string
          time_limit_seconds?: number | null
          total_winner_limit?: number
          updated_at?: string
          winning_condition?: Json
        }
        Relationships: [
          {
            foreignKeyName: "challenges_reward_coupon_id_fkey"
            columns: ["reward_coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      combo_groups: {
        Row: {
          category_ids: string[]
          combo_id: string
          created_at: string
          extra_charge: number
          id: string
          is_required: boolean
          max_select: number
          min_select: number
          name: string
          product_ids: string[]
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_ids?: string[]
          combo_id: string
          created_at?: string
          extra_charge?: number
          id?: string
          is_required?: boolean
          max_select?: number
          min_select?: number
          name: string
          product_ids?: string[]
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_ids?: string[]
          combo_id?: string
          created_at?: string
          extra_charge?: number
          id?: string
          is_required?: boolean
          max_select?: number
          min_select?: number
          name?: string
          product_ids?: string[]
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combo_groups_combo_id_fkey"
            columns: ["combo_id"]
            isOneToOne: false
            referencedRelation: "combos"
            referencedColumns: ["id"]
          },
        ]
      }
      combos: {
        Row: {
          created_at: string
          description: string | null
          fixed_price: number | null
          id: string
          is_active: boolean
          name: string
          pricing_mode: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          fixed_price?: number | null
          id?: string
          is_active?: boolean
          name: string
          pricing_mode?: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          fixed_price?: number | null
          id?: string
          is_active?: boolean
          name?: string
          pricing_mode?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      coupons: {
        Row: {
          code: string
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          expires_on: string | null
          id: string
          is_active: boolean
          max_discount: number | null
          min_order_total: number
          starts_on: string | null
          times_used: number
          updated_at: string
          usage_limit: number | null
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          expires_on?: string | null
          id?: string
          is_active?: boolean
          max_discount?: number | null
          min_order_total?: number
          starts_on?: string | null
          times_used?: number
          updated_at?: string
          usage_limit?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          expires_on?: string | null
          id?: string
          is_active?: boolean
          max_discount?: number | null
          min_order_total?: number
          starts_on?: string | null
          times_used?: number
          updated_at?: string
          usage_limit?: number | null
        }
        Relationships: []
      }
      customer_addresses: {
        Row: {
          address_line: string
          area: string | null
          created_at: string
          delivery_notes: string | null
          full_name: string
          id: string
          is_default: boolean
          label: string | null
          landmark: string | null
          latitude: number | null
          longitude: number | null
          phone: string
          updated_at: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          address_line: string
          area?: string | null
          created_at?: string
          delivery_notes?: string | null
          full_name: string
          id?: string
          is_default?: boolean
          label?: string | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          phone: string
          updated_at?: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          address_line?: string
          area?: string | null
          created_at?: string
          delivery_notes?: string | null
          full_name?: string
          id?: string
          is_default?: boolean
          label?: string | null
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          phone?: string
          updated_at?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: []
      }
      delivery_zones: {
        Row: {
          created_at: string
          delivery_charge: number
          estimated_delivery_time: string | null
          free_delivery_threshold: number | null
          id: string
          is_active: boolean
          is_free_delivery_enabled: boolean
          minimum_order: number
          name: string
          radius_max_m: number | null
          radius_min_m: number | null
          slug: string
          sort_order: number
          updated_at: string
          zone_type: string
        }
        Insert: {
          created_at?: string
          delivery_charge?: number
          estimated_delivery_time?: string | null
          free_delivery_threshold?: number | null
          id?: string
          is_active?: boolean
          is_free_delivery_enabled?: boolean
          minimum_order?: number
          name: string
          radius_max_m?: number | null
          radius_min_m?: number | null
          slug: string
          sort_order?: number
          updated_at?: string
          zone_type?: string
        }
        Update: {
          created_at?: string
          delivery_charge?: number
          estimated_delivery_time?: string | null
          free_delivery_threshold?: number | null
          id?: string
          is_active?: boolean
          is_free_delivery_enabled?: boolean
          minimum_order?: number
          name?: string
          radius_max_m?: number | null
          radius_min_m?: number | null
          slug?: string
          sort_order?: number
          updated_at?: string
          zone_type?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          product_id: string
          product_slug: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          product_slug: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          product_slug?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_items: {
        Row: {
          created_at: string
          current_stock: number
          id: string
          is_active: boolean
          low_stock_threshold: number
          name: string
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_stock?: number
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name: string
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_stock?: number
          id?: string
          is_active?: boolean
          low_stock_threshold?: number
          name?: string
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      inventory_movements: {
        Row: {
          change_type: string
          created_at: string
          created_by: string | null
          id: string
          item_id: string
          note: string | null
          order_id: string | null
          quantity: number
          resulting_stock: number
        }
        Insert: {
          change_type: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id: string
          note?: string | null
          order_id?: string | null
          quantity: number
          resulting_stock: number
        }
        Update: {
          change_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          item_id?: string
          note?: string | null
          order_id?: string | null
          quantity?: number
          resulting_stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_push_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          notification_id: string
          provider_message_id: string | null
          push_token_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          notification_id: string
          provider_message_id?: string | null
          push_token_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          notification_id?: string
          provider_message_id?: string | null
          push_token_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_push_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_push_deliveries_push_token_id_fkey"
            columns: ["push_token_id"]
            isOneToOne: false
            referencedRelation: "push_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          is_read: boolean
          order_code: string | null
          order_id: string | null
          status: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_read?: boolean
          order_code?: string | null
          order_id?: string | null
          status?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean
          order_code?: string | null
          order_id?: string | null
          status?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          order_id: string
          read_by_customer: boolean
          read_by_staff: boolean
          sender_name: string | null
          sender_role: string
          sender_user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          order_id: string
          read_by_customer?: boolean
          read_by_staff?: boolean
          sender_name?: string | null
          sender_role: string
          sender_user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          order_id?: string
          read_by_customer?: boolean
          read_by_staff?: boolean
          sender_name?: string | null
          sender_role?: string
          sender_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          combo_key: string | null
          combo_name: string | null
          created_at: string
          id: string
          image_url: string | null
          order_id: string
          product_id: string
          product_name: string
          product_slug: string
          quantity: number
          unit_price: number
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          combo_key?: string | null
          combo_name?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          order_id: string
          product_id: string
          product_name: string
          product_slug: string
          quantity: number
          unit_price?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          combo_key?: string | null
          combo_name?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          order_id?: string
          product_id?: string
          product_name?: string
          product_slug?: string
          quantity?: number
          unit_price?: number
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          order_id: string
          photo_path: string | null
          product_id: string | null
          rating: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id: string
          photo_path?: string | null
          product_id?: string | null
          rating: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          order_id?: string
          photo_path?: string | null
          product_id?: string | null
          rating?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_line: string | null
          area: string | null
          channel: string
          code: string
          commission_amount: number
          commission_rate: number
          coupon_code: string | null
          created_at: string
          customer_name: string
          customer_phone: string
          delivery_charge: number
          delivery_notes: string | null
          discount: number
          distance_m: number | null
          estimated_time: string | null
          fulfillment: string
          id: string
          landmark: string | null
          latitude: number | null
          longitude: number | null
          net_receivable: number | null
          payment_label: string
          payment_method: string
          pickup_note: string | null
          platform_id: string | null
          platform_name: string | null
          rider_id: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          zone_id: string | null
          zone_name: string | null
          order_kind: string
          payment_status: string
          scheduled_activate_at: string | null
          scheduled_for: string | null
        }
        Insert: {
          address_line?: string | null
          area?: string | null
          channel?: string
          code: string
          commission_amount?: number
          commission_rate?: number
          coupon_code?: string | null
          created_at?: string
          customer_name: string
          customer_phone: string
          delivery_charge?: number
          delivery_notes?: string | null
          discount?: number
          distance_m?: number | null
          estimated_time?: string | null
          fulfillment: string
          id?: string
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          net_receivable?: number | null
          payment_label: string
          payment_method: string
          pickup_note?: string | null
          platform_id?: string | null
          platform_name?: string | null
          rider_id?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string | null
          zone_id?: string | null
          zone_name?: string | null
          order_kind?: string
          payment_status?: string
          scheduled_activate_at?: string | null
          scheduled_for?: string | null
        }
        Update: {
          address_line?: string | null
          area?: string | null
          channel?: string
          code?: string
          commission_amount?: number
          commission_rate?: number
          coupon_code?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string
          delivery_charge?: number
          delivery_notes?: string | null
          discount?: number
          distance_m?: number | null
          estimated_time?: string | null
          fulfillment?: string
          id?: string
          landmark?: string | null
          latitude?: number | null
          longitude?: number | null
          net_receivable?: number | null
          payment_label?: string
          payment_method?: string
          pickup_note?: string | null
          platform_id?: string | null
          platform_name?: string | null
          rider_id?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string | null
          zone_id?: string | null
          zone_name?: string | null
          order_kind?: string
          payment_status?: string
          scheduled_activate_at?: string | null
          scheduled_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "sales_platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
        ]
      }
      owner_invites: {
        Row: {
          created_at: string
          id: string
          note: string | null
          phone: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          phone: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          phone?: string
        }
        Relationships: []
      }
      payment_providers: {
        Row: {
          created_at: string
          id: string
          is_enabled: boolean
          label: string
          merchant_reference: string | null
          mode: string
          note: string | null
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          label: string
          merchant_reference?: string | null
          mode?: string
          note?: string | null
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_enabled?: boolean
          label?: string
          merchant_reference?: string | null
          mode?: string
          note?: string | null
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_product_prices: {
        Row: {
          created_at: string
          id: string
          platform_id: string
          price: number
          product_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform_id: string
          price: number
          product_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          platform_id?: string
          price?: number
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_product_prices_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "sales_platforms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "platform_product_prices_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt: string
          created_at: string
          id: string
          is_primary: boolean
          product_id: string
          sort_order: number
          updated_at: string
          url: string | null
        }
        Insert: {
          alt: string
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Update: {
          alt?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_ingredients: {
        Row: {
          created_at: string
          id: string
          item_id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_ingredients_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_ingredients_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          created_at: string
          id: string
          is_available: boolean
          name: string
          price: number
          product_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_available?: boolean
          name: string
          price?: number
          product_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_available?: boolean
          name?: string
          price?: number
          product_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          badges: string[]
          base_price: number
          category_id: string
          counter_price: number | null
          created_at: string
          description: string | null
          id: string
          is_available: boolean
          is_featured: boolean
          is_popular: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          badges?: string[]
          base_price?: number
          category_id: string
          counter_price?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_available?: boolean
          is_featured?: boolean
          is_popular?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          badges?: string[]
          base_price?: number
          category_id?: string
          counter_price?: number | null
          created_at?: string
          description?: string | null
          id?: string
          is_available?: boolean
          is_featured?: boolean
          is_popular?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_line: string | null
          avatar_path: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          avatar_path?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          avatar_path?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promo_banners: {
        Row: {
          created_at: string
          cta_href: string | null
          cta_label: string | null
          desktop_image_path: string | null
          id: string
          is_active: boolean
          mobile_image_path: string | null
          sort_order: number
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          desktop_image_path?: string | null
          id?: string
          is_active?: boolean
          mobile_image_path?: string | null
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cta_href?: string | null
          cta_label?: string | null
          desktop_image_path?: string | null
          id?: string
          is_active?: boolean
          mobile_image_path?: string | null
          sort_order?: number
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          created_at: string
          created_by: string | null
          expense_category: string | null
          expense_name: string | null
          id: string
          item_id: string | null
          kind: string
          note: string | null
          payment_method: string | null
          purchased_on: string
          quantity: number
          supplier_name: string
          total_price: number
          unit_label: string | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expense_category?: string | null
          expense_name?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          note?: string | null
          payment_method?: string | null
          purchased_on?: string
          quantity: number
          supplier_name: string
          total_price?: number
          unit_label?: string | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expense_category?: string | null
          expense_name?: string | null
          id?: string
          item_id?: string | null
          kind?: string
          note?: string | null
          payment_method?: string | null
          purchased_on?: string
          quantity?: number
          supplier_name?: string
          total_price?: number
          unit_label?: string | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inventory_items"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      restaurant_settings: {
        Row: {
          address_line: string | null
          city: string | null
          closes_at: string | null
          country: string | null
          created_at: string
          email: string | null
          facebook_page_name: string | null
          facebook_url: string | null
          google_maps_url: string | null
          id: string
          instagram_url: string | null
          inventory_mode: string
          is_open: boolean
          latitude: number | null
          longitude: number | null
          name: string
          opens_at: string | null
          phone: string | null
          recommendations_count: number
          recommendations_enabled: boolean
          review_photos_enabled: boolean
          reviews_enabled: boolean
          tagline: string | null
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          closes_at?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          facebook_page_name?: string | null
          facebook_url?: string | null
          google_maps_url?: string | null
          id?: string
          instagram_url?: string | null
          inventory_mode?: string
          is_open?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          opens_at?: string | null
          phone?: string | null
          recommendations_count?: number
          recommendations_enabled?: boolean
          review_photos_enabled?: boolean
          reviews_enabled?: boolean
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          city?: string | null
          closes_at?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          facebook_page_name?: string | null
          facebook_url?: string | null
          google_maps_url?: string | null
          id?: string
          instagram_url?: string | null
          inventory_mode?: string
          is_open?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          opens_at?: string | null
          phone?: string | null
          recommendations_count?: number
          recommendations_enabled?: boolean
          review_photos_enabled?: boolean
          reviews_enabled?: boolean
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      reward_claims: {
        Row: {
          created_at: string
          id: string
          note: string | null
          reference: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          reference: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          reference?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_claims_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "reward_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      reward_rules: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          name: string
          points: number
          requires_claim: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          name: string
          points?: number
          requires_claim?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          name?: string
          points?: number
          requires_claim?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      reward_transactions: {
        Row: {
          action_key: string
          created_at: string
          description: string
          id: string
          points: number
          reference_id: string
          rule_id: string | null
          user_id: string
        }
        Insert: {
          action_key: string
          created_at?: string
          description: string
          id?: string
          points: number
          reference_id: string
          rule_id?: string | null
          user_id: string
        }
        Update: {
          action_key?: string
          created_at?: string
          description?: string
          id?: string
          points?: number
          reference_id?: string
          rule_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reward_transactions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "reward_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      riders: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          note: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          note?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          note?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sales_platforms: {
        Row: {
          commission_percent: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          pricing_mode: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          commission_percent?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          pricing_mode?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          commission_percent?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          pricing_mode?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      staff_ledger_audit: {
        Row: {
          action: string
          after_data: Json | null
          before_data: Json | null
          changed_by: string | null
          created_at: string
          entry_id: string
          id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          action: string
          after_data?: Json | null
          before_data?: Json | null
          changed_by?: string | null
          created_at?: string
          entry_id: string
          id?: string
          reason?: string | null
          user_id: string
        }
        Update: {
          action?: string
          after_data?: Json | null
          before_data?: Json | null
          changed_by?: string | null
          created_at?: string
          entry_id?: string
          id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      staff_ledger_entries: {
        Row: {
          amount: number
          status: string
          reason: string | null
          submitted_by: string | null
          approved_by: string | null
          approved_at: string | null
          decision_note: string | null
          created_at: string
          entry_date: string
          entry_type: string
          id: string
          note: string | null
          payment_method: string | null
          recorded_by: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          amount: number
          status?: string
          reason?: string | null
          submitted_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          decision_note?: string | null
          created_at?: string
          entry_date?: string
          entry_type: string
          id?: string
          note?: string | null
          payment_method?: string | null
          recorded_by?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          status?: string
          reason?: string | null
          submitted_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          decision_note?: string | null
          created_at?: string
          entry_date?: string
          entry_type?: string
          id?: string
          note?: string | null
          payment_method?: string | null
          recorded_by?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      staff_permissions: {
        Row: {
          created_at: string
          id: string
          permission: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      staff_salary_profiles: {
        Row: {
          created_at: string
          daily_rate: number
          id: string
          is_active: boolean
          monthly_rate: number
          overtime_hourly_rate: number
          pay_type: string
          payday: number
          starts_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_rate?: number
          id?: string
          is_active?: boolean
          monthly_rate?: number
          overtime_hourly_rate?: number
          pay_type?: string
          payday?: number
          starts_on?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_rate?: number
          id?: string
          is_active?: boolean
          monthly_rate?: number
          overtime_hourly_rate?: number
          pay_type?: string
          payday?: number
          starts_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          note: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          note?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          note?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_stock_change: {
        Args: {
          _change_type: string
          _created_by?: string
          _item_id: string
          _note?: string
          _quantity: number
        }
        Returns: number
      }
      claim_owner: { Args: { _user_id: string }; Returns: boolean }
      consume_inventory_for_order: {
        Args: { _order_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "staff"
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
    Enums: {
      app_role: ["owner", "admin", "staff"],
    },
  },
} as const

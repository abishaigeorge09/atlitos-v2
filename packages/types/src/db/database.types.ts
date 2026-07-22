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
      addresses: {
        Row: {
          city: string
          created_at: string
          id: string
          is_default: boolean
          line1: string
          line2: string | null
          pincode: string
          state: string
          user_id: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          is_default?: boolean
          line1: string
          line2?: string | null
          pincode: string
          state: string
          user_id: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          is_default?: boolean
          line1?: string
          line2?: string | null
          pincode?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "addresses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      athlete_sports: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          skill_level: string | null
          sport: Database["public"]["Enums"]["sport"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          skill_level?: string | null
          sport: Database["public"]["Enums"]["sport"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          skill_level?: string | null
          sport?: Database["public"]["Enums"]["sport"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "athlete_sports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "athlete_sports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "athlete_sports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          note: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          note?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          created_at: string
          id: string
          product_variant_id: string
          qty: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_variant_id: string
          qty: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_variant_id?: string
          qty?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variant_availability"
            referencedColumns: ["product_variant_id"]
          },
          {
            foreignKeyName: "cart_items_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          sender_id: string
          text: string
          thread_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          sender_id: string
          text: string
          thread_id: string
        }
        Update: {
          created_at?: string
          id?: string
          sender_id?: string
          text?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          context_id: string
          context_type: string
          created_at: string
          id: string
          last_message_at: string | null
          participant_a: string
          participant_b: string
        }
        Insert: {
          context_id: string
          context_type: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          participant_a: string
          participant_b: string
        }
        Update: {
          context_id?: string
          context_type?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          participant_a?: string
          participant_b?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_threads_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_threads_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chat_threads_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_threads_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_comments: {
        Row: {
          clip_id: string
          created_at: string
          id: string
          text: string
          user_id: string
        }
        Insert: {
          clip_id: string
          created_at?: string
          id?: string
          text: string
          user_id: string
        }
        Update: {
          clip_id?: string
          created_at?: string
          id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_comments_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clip_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clip_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clip_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clip_likes: {
        Row: {
          clip_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          clip_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          clip_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clip_likes_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clip_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clip_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clip_likes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      clips: {
        Row: {
          caption: string
          cf_stream_uid: string | null
          comment_count: number
          created_at: string
          id: string
          likes_count: number
          owner_id: string
          playback_id: string | null
          rejection_reason: string | null
          sport: Database["public"]["Enums"]["sport"]
          status: Database["public"]["Enums"]["clip_status"]
          storage_path: string | null
          thumb_path: string | null
          updated_at: string
        }
        Insert: {
          caption: string
          cf_stream_uid?: string | null
          comment_count?: number
          created_at?: string
          id?: string
          likes_count?: number
          owner_id: string
          playback_id?: string | null
          rejection_reason?: string | null
          sport: Database["public"]["Enums"]["sport"]
          status?: Database["public"]["Enums"]["clip_status"]
          storage_path?: string | null
          thumb_path?: string | null
          updated_at?: string
        }
        Update: {
          caption?: string
          cf_stream_uid?: string | null
          comment_count?: number
          created_at?: string
          id?: string
          likes_count?: number
          owner_id?: string
          playback_id?: string | null
          rejection_reason?: string | null
          sport?: Database["public"]["Enums"]["sport"]
          status?: Database["public"]["Enums"]["clip_status"]
          storage_path?: string | null
          thumb_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clips_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "clips_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clips_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_availability_windows: {
        Row: {
          coach_id: string
          created_at: string
          day_of_week: number
          effective_from: string
          end_time: string
          id: string
          start_time: string
        }
        Insert: {
          coach_id: string
          created_at?: string
          day_of_week: number
          effective_from?: string
          end_time: string
          id?: string
          start_time: string
        }
        Update: {
          coach_id?: string
          created_at?: string
          day_of_week?: number
          effective_from?: string
          end_time?: string
          id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_availability_windows_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coach_availability_windows_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      coach_certificates: {
        Row: {
          coach_id: string
          created_at: string
          id: string
          name: string
          storage_path: string
          verified: boolean
        }
        Insert: {
          coach_id: string
          created_at?: string
          id?: string
          name: string
          storage_path: string
          verified?: boolean
        }
        Update: {
          coach_id?: string
          created_at?: string
          id?: string
          name?: string
          storage_path?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "coach_certificates_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coach_certificates_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      coach_profiles: {
        Row: {
          bio: string | null
          city: string
          coaching_style: string | null
          created_at: string
          experience_years: number
          players_coached_count: number
          rating: number
          rating_count: number
          specialization: string[]
          sport: Database["public"]["Enums"]["sport"]
          state: string
          status: Database["public"]["Enums"]["coach_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          bio?: string | null
          city: string
          coaching_style?: string | null
          created_at?: string
          experience_years: number
          players_coached_count?: number
          rating?: number
          rating_count?: number
          specialization?: string[]
          sport: Database["public"]["Enums"]["sport"]
          state: string
          status?: Database["public"]["Enums"]["coach_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          bio?: string | null
          city?: string
          coaching_style?: string | null
          created_at?: string
          experience_years?: number
          players_coached_count?: number
          rating?: number
          rating_count?: number
          specialization?: string[]
          sport?: Database["public"]["Enums"]["sport"]
          state?: string
          status?: Database["public"]["Enums"]["coach_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      court_availability_windows: {
        Row: {
          close_time: string
          court_id: string
          created_at: string
          day_of_week: number
          id: string
          open_time: string
          slot_duration_minutes: number
        }
        Insert: {
          close_time: string
          court_id: string
          created_at?: string
          day_of_week: number
          id?: string
          open_time: string
          slot_duration_minutes?: number
        }
        Update: {
          close_time?: string
          court_id?: string
          created_at?: string
          day_of_week?: number
          id?: string
          open_time?: string
          slot_duration_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "court_availability_windows_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      court_blackouts: {
        Row: {
          court_id: string
          created_at: string
          end_date: string
          id: string
          reason: string
          start_date: string
        }
        Insert: {
          court_id: string
          created_at?: string
          end_date: string
          id?: string
          reason: string
          start_date: string
        }
        Update: {
          court_id?: string
          created_at?: string
          end_date?: string
          id?: string
          reason?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_blackouts_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      court_bookings: {
        Row: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          date: string
          gst: number
          id: string
          payment_intent_id: string | null
          platform_fee: number
          rating: number | null
          remarks: string | null
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        Insert: {
          booking_source?: Database["public"]["Enums"]["booking_source"]
          cancellation_reason?: string | null
          checked_in_at?: string | null
          court_id: string
          created_at?: string
          created_by_staff_id?: string | null
          date: string
          gst: number
          id?: string
          payment_intent_id?: string | null
          platform_fee: number
          rating?: number | null
          remarks?: string | null
          slot_end: string
          slot_start: string
          status?: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at?: string
          user_id?: string | null
          walk_in_name?: string | null
          walk_in_phone?: string | null
        }
        Update: {
          booking_source?: Database["public"]["Enums"]["booking_source"]
          cancellation_reason?: string | null
          checked_in_at?: string | null
          court_id?: string
          created_at?: string
          created_by_staff_id?: string | null
          date?: string
          gst?: number
          id?: string
          payment_intent_id?: string | null
          platform_fee?: number
          rating?: number | null
          remarks?: string | null
          slot_end?: string
          slot_start?: string
          status?: Database["public"]["Enums"]["court_booking_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string | null
          walk_in_name?: string | null
          walk_in_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_bookings_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "court_bookings_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "court_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      court_pricing_rules: {
        Row: {
          active: boolean
          court_id: string
          created_at: string
          day_of_week_end: number
          day_of_week_start: number
          fixed_price: number | null
          id: string
          multiplier: number | null
          time_end: string
          time_start: string
        }
        Insert: {
          active?: boolean
          court_id: string
          created_at?: string
          day_of_week_end: number
          day_of_week_start: number
          fixed_price?: number | null
          id?: string
          multiplier?: number | null
          time_end: string
          time_start: string
        }
        Update: {
          active?: boolean
          court_id?: string
          created_at?: string
          day_of_week_end?: number
          day_of_week_start?: number
          fixed_price?: number | null
          id?: string
          multiplier?: number | null
          time_end?: string
          time_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "court_pricing_rules_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
        ]
      }
      courts: {
        Row: {
          active: boolean
          base_price_per_hour: number
          capacity: number | null
          created_at: string
          id: string
          name: string
          sport: Database["public"]["Enums"]["sport"]
          updated_at: string
          venue_id: string
        }
        Insert: {
          active?: boolean
          base_price_per_hour: number
          capacity?: number | null
          created_at?: string
          id?: string
          name: string
          sport: Database["public"]["Enums"]["sport"]
          updated_at?: string
          venue_id: string
        }
        Update: {
          active?: boolean
          base_price_per_hour?: number
          capacity?: number | null
          created_at?: string
          id?: string
          name?: string
          sport?: Database["public"]["Enums"]["sport"]
          updated_at?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          description: string
          enabled: boolean
          id: string
          key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          enabled?: boolean
          id?: string
          key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          enabled?: boolean
          id?: string
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      fee_config: {
        Row: {
          created_at: string
          domain: string
          effective_from: string
          id: string
          key: string
          value: number
          value_type: Database["public"]["Enums"]["fee_value_type"]
        }
        Insert: {
          created_at?: string
          domain: string
          effective_from?: string
          id?: string
          key: string
          value: number
          value_type: Database["public"]["Enums"]["fee_value_type"]
        }
        Update: {
          created_at?: string
          domain?: string
          effective_from?: string
          id?: string
          key?: string
          value?: number
          value_type?: Database["public"]["Enums"]["fee_value_type"]
        }
        Relationships: []
      }
      follows: {
        Row: {
          created_at: string
          followee_id: string
          follower_id: string
          id: string
        }
        Insert: {
          created_at?: string
          followee_id: string
          follower_id: string
          id?: string
        }
        Update: {
          created_at?: string
          followee_id?: string
          follower_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_followee_id_fkey"
            columns: ["followee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account_ref: string | null
          account_type: Database["public"]["Enums"]["ledger_account_type"]
          amount: number
          created_at: string
          description: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string
          entry_group_id: string
          id: string
          payment_intent_id: string | null
        }
        Insert: {
          account_ref?: string | null
          account_type: Database["public"]["Enums"]["ledger_account_type"]
          amount: number
          created_at?: string
          description: string
          direction: Database["public"]["Enums"]["ledger_direction"]
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string
          entry_group_id: string
          id?: string
          payment_intent_id?: string | null
        }
        Update: {
          account_ref?: string | null
          account_type?: Database["public"]["Enums"]["ledger_account_type"]
          amount?: number
          created_at?: string
          description?: string
          direction?: Database["public"]["Enums"]["ledger_direction"]
          domain?: Database["public"]["Enums"]["payment_domain"]
          entity_id?: string
          entry_group_id?: string
          id?: string
          payment_intent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          created_at: string
          email_enabled: boolean
          id: string
          notification_type: Database["public"]["Enums"]["notification_type"]
          push_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          notification_type: Database["public"]["Enums"]["notification_type"]
          push_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          id?: string
          notification_type?: Database["public"]["Enums"]["notification_type"]
          push_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          deep_link: string
          id: string
          read_at: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deep_link: string
          id?: string
          read_at?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deep_link?: string
          id?: string
          read_at?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_drafts: {
        Row: {
          address_id: string | null
          created_at: string
          delivery_charges: number
          donation_roundup: number
          gst_and_others: number
          id: string
          lines: Json
          payment_intent_id: string
          ship_to_city: string
          ship_to_line1: string
          ship_to_line2: string | null
          ship_to_pincode: string
          ship_to_state: string
          subtotal: number
          total: number
          user_id: string
        }
        Insert: {
          address_id?: string | null
          created_at?: string
          delivery_charges?: number
          donation_roundup?: number
          gst_and_others?: number
          id?: string
          lines: Json
          payment_intent_id: string
          ship_to_city: string
          ship_to_line1: string
          ship_to_line2?: string | null
          ship_to_pincode: string
          ship_to_state: string
          subtotal: number
          total: number
          user_id: string
        }
        Update: {
          address_id?: string | null
          created_at?: string
          delivery_charges?: number
          donation_roundup?: number
          gst_and_others?: number
          id?: string
          lines?: Json
          payment_intent_id?: string
          ship_to_city?: string
          ship_to_line1?: string
          ship_to_line2?: string | null
          ship_to_pincode?: string
          ship_to_state?: string
          subtotal?: number
          total?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_drafts_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_drafts_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: true
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "order_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_feedback: {
        Row: {
          created_at: string
          id: string
          order_id: string
          rating: number
          remarks: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          rating: number
          remarks?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          rating?: number
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          product_title_snapshot: string
          product_variant_id: string
          qty: number
          unit_price: number
          variant_label_snapshot: string
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          product_title_snapshot: string
          product_variant_id: string
          qty: number
          unit_price: number
          variant_label_snapshot: string
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          product_title_snapshot?: string
          product_variant_id?: string
          qty?: number
          unit_price?: number
          variant_label_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variant_availability"
            referencedColumns: ["product_variant_id"]
          },
          {
            foreignKeyName: "order_items_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_timeline: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          location: string | null
          note: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          location?: string | null
          note?: string | null
          order_id: string
          status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          location?: string | null
          note?: string | null
          order_id?: string
          status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_timeline_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "order_timeline_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_timeline_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_timeline_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address_id: string | null
          created_at: string
          delivery_charges: number
          donation_roundup: number
          gst_and_others: number
          id: string
          order_number: string
          payment_intent_id: string | null
          ship_to_city: string
          ship_to_line1: string
          ship_to_line2: string | null
          ship_to_pincode: string
          ship_to_state: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          address_id?: string | null
          created_at?: string
          delivery_charges?: number
          donation_roundup?: number
          gst_and_others?: number
          id?: string
          order_number?: string
          payment_intent_id?: string | null
          ship_to_city: string
          ship_to_line1: string
          ship_to_line2?: string | null
          ship_to_pincode: string
          ship_to_state: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at?: string
          user_id: string
        }
        Update: {
          address_id?: string | null
          created_at?: string
          delivery_charges?: number
          donation_roundup?: number
          gst_and_others?: number
          id?: string
          order_number?: string
          payment_intent_id?: string | null
          ship_to_city?: string
          ship_to_line1?: string
          ship_to_line2?: string | null
          ship_to_pincode?: string
          ship_to_state?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          created_at: string
          currency: string
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string | null
          id: string
          razorpay_order_id: string
          razorpay_payment_id: string | null
          status: Database["public"]["Enums"]["payment_intent_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id?: string | null
          id?: string
          razorpay_order_id: string
          razorpay_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_intent_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          domain?: Database["public"]["Enums"]["payment_domain"]
          entity_id?: string | null
          id?: string
          razorpay_order_id?: string
          razorpay_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_intent_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_accounts: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          owner_type: string
          razorpay_account_id: string | null
          status: Database["public"]["Enums"]["payout_account_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          owner_type: string
          razorpay_account_id?: string | null
          status?: Database["public"]["Enums"]["payout_account_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          owner_type?: string
          razorpay_account_id?: string | null
          status?: Database["public"]["Enums"]["payout_account_status"]
          updated_at?: string
        }
        Relationships: []
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          position: number
          product_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          position?: number
          product_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          position?: number
          product_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string | null
          created_at: string
          id: string
          price_override: number | null
          product_id: string
          size: string | null
          sku: string
          stock: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          price_override?: number | null
          product_id: string
          size?: string | null
          sku: string
          stock?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          price_override?: number | null
          product_id?: string
          size?: string | null
          sku?: string
          stock?: number
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
      product_wishlist_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_wishlist_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          active: boolean
          base_price: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          recommended_rank: number | null
          sport: Database["public"]["Enums"]["sport"] | null
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          recommended_rank?: number | null
          sport?: Database["public"]["Enums"]["sport"] | null
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price?: number
          category_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          recommended_rank?: number | null
          sport?: Database["public"]["Enums"]["sport"] | null
          title?: string
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
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "shopper_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          attempts: number
          created_at: string
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string
          failure_reason: string | null
          id: string
          ledger_entry_group_id: string | null
          payment_intent_id: string
          razorpay_refund_id: string | null
          status: Database["public"]["Enums"]["refund_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          attempts?: number
          created_at?: string
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string
          failure_reason?: string | null
          id?: string
          ledger_entry_group_id?: string | null
          payment_intent_id: string
          razorpay_refund_id?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          attempts?: number
          created_at?: string
          domain?: Database["public"]["Enums"]["payment_domain"]
          entity_id?: string
          failure_reason?: string | null
          id?: string
          ledger_entry_group_id?: string | null
          payment_intent_id?: string
          razorpay_refund_id?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          reason: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          reason: string
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          reason?: string
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      session_types: {
        Row: {
          active: boolean
          coach_id: string
          created_at: string
          duration_minutes: number
          id: string
          name: string
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          coach_id: string
          created_at?: string
          duration_minutes: number
          id?: string
          name: string
          price: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          coach_id?: string
          created_at?: string
          duration_minutes?: number
          id?: string
          name?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_types_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "session_types_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      sessions: {
        Row: {
          cancellation_reason: string | null
          coach_id: string
          created_at: string
          date: string
          decline_reason: string | null
          focus_area: string | null
          frequency: Database["public"]["Enums"]["session_frequency"]
          id: string
          location: string | null
          payment_intent_id: string | null
          platform_fee: number
          player_id: string
          price: number
          rating: number | null
          remarks: string | null
          session_type_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["session_status"]
          total: number
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          coach_id: string
          created_at?: string
          date: string
          decline_reason?: string | null
          focus_area?: string | null
          frequency: Database["public"]["Enums"]["session_frequency"]
          id?: string
          location?: string | null
          payment_intent_id?: string | null
          platform_fee: number
          player_id: string
          price: number
          rating?: number | null
          remarks?: string | null
          session_type_id: string
          slot_end: string
          slot_start: string
          status?: Database["public"]["Enums"]["session_status"]
          total: number
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          coach_id?: string
          created_at?: string
          date?: string
          decline_reason?: string | null
          focus_area?: string | null
          frequency?: Database["public"]["Enums"]["session_frequency"]
          id?: string
          location?: string | null
          payment_intent_id?: string | null
          platform_fee?: number
          player_id?: string
          price?: number
          rating?: number | null
          remarks?: string | null
          session_type_id?: string
          slot_end?: string
          slot_start?: string
          status?: Database["public"]["Enums"]["session_status"]
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sessions_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "coach_profiles_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sessions_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "sessions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_session_type_id_fkey"
            columns: ["session_type_id"]
            isOneToOne: false
            referencedRelation: "session_types"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reservations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          payment_intent_id: string
          product_variant_id: string
          qty: number
          release_reason: string | null
          status: Database["public"]["Enums"]["stock_reservation_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          payment_intent_id: string
          product_variant_id: string
          qty: number
          release_reason?: string | null
          status?: Database["public"]["Enums"]["stock_reservation_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          payment_intent_id?: string
          product_variant_id?: string
          qty?: number
          release_reason?: string | null
          status?: Database["public"]["Enums"]["stock_reservation_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_reservations_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reservations_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variant_availability"
            referencedColumns: ["product_variant_id"]
          },
          {
            foreignKeyName: "stock_reservations_product_variant_id_fkey"
            columns: ["product_variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string
          description: string
          id: string
          resolution_note: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["ticket_status"]
          subject: string
          submitter_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject: string
          submitter_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["ticket_status"]
          subject?: string
          submitter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_tickets_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_submitter_id_fkey"
            columns: ["submitter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      transfers: {
        Row: {
          amount: number
          created_at: string
          failure_reason: string | null
          id: string
          ledger_entry_group_id: string
          payout_account_id: string
          razorpay_transfer_id: string | null
          reversal_ledger_entry_group_id: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          ledger_entry_group_id: string
          payout_account_id: string
          razorpay_transfer_id?: string | null
          reversal_ledger_entry_group_id?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          ledger_entry_group_id?: string
          payout_account_id?: string
          razorpay_transfer_id?: string | null
          reversal_ledger_entry_group_id?: string | null
          status?: Database["public"]["Enums"]["transfer_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_payout_account_id_fkey"
            columns: ["payout_account_id"]
            isOneToOne: false
            referencedRelation: "payout_accounts"
            referencedColumns: ["id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          channel_name: string | null
          city: string | null
          created_at: string
          dob: string | null
          id: string
          name: string
          phone: string | null
          show_donor_name: boolean
          sports: Database["public"]["Enums"]["sport"][]
          state: string | null
          status: Database["public"]["Enums"]["user_status"]
          suspended_reason: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          channel_name?: string | null
          city?: string | null
          created_at?: string
          dob?: string | null
          id: string
          name: string
          phone?: string | null
          show_donor_name?: boolean
          sports?: Database["public"]["Enums"]["sport"][]
          state?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          suspended_reason?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          channel_name?: string | null
          city?: string | null
          created_at?: string
          dob?: string | null
          id?: string
          name?: string
          phone?: string | null
          show_donor_name?: boolean
          sports?: Database["public"]["Enums"]["sport"][]
          state?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          suspended_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      venue_photos: {
        Row: {
          created_at: string
          id: string
          position: number
          storage_path: string
          venue_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          position?: number
          storage_path: string
          venue_id: string
        }
        Update: {
          created_at?: string
          id?: string
          position?: number
          storage_path?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_photos_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venue_staff: {
        Row: {
          accepted_at: string | null
          id: string
          invited_at: string
          user_id: string
          venue_id: string
        }
        Insert: {
          accepted_at?: string | null
          id?: string
          invited_at?: string
          user_id: string
          venue_id: string
        }
        Update: {
          accepted_at?: string | null
          id?: string
          invited_at?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "venue_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_staff_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string
          city: string
          created_at: string
          description: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          partner_user_id: string
          pincode: string
          rejection_reason: string | null
          status: Database["public"]["Enums"]["venue_status"]
          updated_at: string
        }
        Insert: {
          address: string
          city: string
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          partner_user_id: string
          pincode: string
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["venue_status"]
          updated_at?: string
        }
        Update: {
          address?: string
          city?: string
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          partner_user_id?: string
          pincode?: string
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["venue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "venues_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venues_partner_user_id_fkey"
            columns: ["partner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_requests: {
        Row: {
          applicant_id: string
          applicant_type: Database["public"]["Enums"]["applicant_type"]
          created_at: string
          id: string
          payload: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["verification_status"]
        }
        Insert: {
          applicant_id: string
          applicant_type: Database["public"]["Enums"]["applicant_type"]
          created_at?: string
          id?: string
          payload: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
        }
        Update: {
          applicant_id?: string
          applicant_type?: Database["public"]["Enums"]["applicant_type"]
          created_at?: string
          id?: string
          payload?: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["verification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "verification_requests_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "verification_requests_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_requests_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          event_type: string
          id: string
          payload: Json
          processed_at: string
        }
        Insert: {
          event_type: string
          id: string
          payload: Json
          processed_at?: string
        }
        Update: {
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      coach_profiles_public: {
        Row: {
          bio: string | null
          city: string | null
          coaching_style: string | null
          created_at: string | null
          experience_years: number | null
          players_coached_count: number | null
          rating: number | null
          rating_count: number | null
          specialization: string[] | null
          sport: Database["public"]["Enums"]["sport"] | null
          state: string | null
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          city?: string | null
          coaching_style?: string | null
          created_at?: string | null
          experience_years?: number | null
          players_coached_count?: number | null
          rating?: number | null
          rating_count?: number | null
          specialization?: string[] | null
          sport?: Database["public"]["Enums"]["sport"] | null
          state?: string | null
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          city?: string | null
          coaching_style?: string | null
          created_at?: string | null
          experience_years?: number | null
          players_coached_count?: number | null
          rating?: number | null
          rating_count?: number | null
          specialization?: string[] | null
          sport?: Database["public"]["Enums"]["sport"] | null
          state?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      creator_stats: {
        Row: {
          followers_count: number | null
          following_count: number | null
          published_clips_count: number | null
          total_likes: number | null
          user_id: string | null
        }
        Insert: {
          followers_count?: never
          following_count?: never
          published_clips_count?: never
          total_likes?: never
          user_id?: string | null
        }
        Update: {
          followers_count?: never
          following_count?: never
          published_clips_count?: never
          total_likes?: never
          user_id?: string | null
        }
        Relationships: []
      }
      product_variant_availability: {
        Row: {
          available_stock: number | null
          color: string | null
          effective_price: number | null
          held_qty: number | null
          product_id: string | null
          product_variant_id: string | null
          size: string | null
          sku: string | null
          stock: number | null
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
      public_profiles: {
        Row: {
          avatar_url: string | null
          channel_name: string | null
          id: string | null
          name: string | null
        }
        Insert: {
          avatar_url?: string | null
          channel_name?: string | null
          id?: string | null
          name?: string | null
        }
        Update: {
          avatar_url?: string | null
          channel_name?: string | null
          id?: string | null
          name?: string | null
        }
        Relationships: []
      }
      shopper_categories: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
          slug: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      venue_bookings_today: {
        Row: {
          booking_source: Database["public"]["Enums"]["booking_source"] | null
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string | null
          court_name: string | null
          court_sport: Database["public"]["Enums"]["sport"] | null
          created_at: string | null
          created_by_staff_id: string | null
          date: string | null
          gst: number | null
          id: string | null
          payment_intent_id: string | null
          platform_fee: number | null
          rating: number | null
          remarks: string | null
          slot_end: string | null
          slot_start: string | null
          status: Database["public"]["Enums"]["court_booking_status"] | null
          subtotal: number | null
          total: number | null
          updated_at: string | null
          user_id: string | null
          venue_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "court_bookings_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "court_bookings_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_created_by_staff_id_fkey"
            columns: ["created_by_staff_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "creator_stats"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "court_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "public_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "court_bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courts_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_venue_staff_invite: {
        Args: { p_venue_staff_id: string }
        Returns: {
          accepted_at: string | null
          id: string
          invited_at: string
          user_id: string
          venue_id: string
        }
        SetofOptions: {
          from: "*"
          to: "venue_staff"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_to_cart: {
        Args: { p_qty?: number; p_variant_id: string }
        Returns: Database["public"]["CompositeTypes"]["cart_mutation_result"]
        SetofOptions: {
          from: "*"
          to: "cart_mutation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_adjust_variant_stock: {
        Args: { p_id: string; p_new_stock: number; p_reason: string }
        Returns: {
          color: string | null
          created_at: string
          id: string
          price_override: number | null
          product_id: string
          size: string | null
          sku: string
          stock: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "product_variants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_approve_verification_request: {
        Args: { p_request_id: string }
        Returns: {
          applicant_id: string
          applicant_type: Database["public"]["Enums"]["applicant_type"]
          created_at: string
          id: string
          payload: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "verification_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_product: {
        Args: {
          p_base_price: number
          p_category_id: string
          p_description: string
          p_media: Json
          p_sport?: Database["public"]["Enums"]["sport"]
          p_title: string
        }
        Returns: {
          active: boolean
          base_price: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          recommended_rank: number | null
          sport: Database["public"]["Enums"]["sport"] | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_variant: {
        Args: {
          p_color?: string
          p_price_override?: number
          p_product_id: string
          p_size?: string
          p_sku: string
          p_stock?: number
        }
        Returns: {
          color: string | null
          created_at: string
          id: string
          price_override: number | null
          product_id: string
          size: string | null
          sku: string
          stock: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "product_variants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_delete_variant: { Args: { p_id: string }; Returns: undefined }
      admin_reject_verification_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: {
          applicant_id: string
          applicant_type: Database["public"]["Enums"]["applicant_type"]
          created_at: string
          id: string
          payload: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["verification_status"]
        }
        SetofOptions: {
          from: "*"
          to: "verification_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_product_active: {
        Args: { p_active: boolean; p_id: string }
        Returns: {
          active: boolean
          base_price: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          recommended_rank: number | null
          sport: Database["public"]["Enums"]["sport"] | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_product_media: {
        Args: { p_media: Json; p_product_id: string }
        Returns: {
          created_at: string
          id: string
          is_primary: boolean
          position: number
          product_id: string
          storage_path: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_media"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_update_fee_config: {
        Args: { p_id: string; p_note: string; p_value: number }
        Returns: {
          created_at: string
          domain: string
          effective_from: string
          id: string
          key: string
          value: number
          value_type: Database["public"]["Enums"]["fee_value_type"]
        }
        SetofOptions: {
          from: "*"
          to: "fee_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_product: {
        Args: {
          p_base_price: number
          p_category_id: string
          p_description: string
          p_id: string
          p_sport?: Database["public"]["Enums"]["sport"]
          p_title: string
        }
        Returns: {
          active: boolean
          base_price: number
          category_id: string | null
          created_at: string
          description: string | null
          id: string
          recommended_rank: number | null
          sport: Database["public"]["Enums"]["sport"] | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_variant: {
        Args: {
          p_color?: string
          p_id: string
          p_price_override?: number
          p_size?: string
          p_sku: string
        }
        Returns: {
          color: string | null
          created_at: string
          id: string
          price_override: number | null
          product_id: string
          size: string | null
          sku: string
          stock: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "product_variants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_variant_stock: {
        Args: { p_product_id?: string }
        Returns: {
          available_stock: number
          color: string
          held_qty: number
          price_override: number
          product_id: string
          product_variant_id: string
          raw_stock: number
          size: string
          sku: string
        }[]
      }
      audit_changed_fields: {
        Args: { p_after: Json; p_before: Json }
        Returns: Json
      }
      clip_transition_internal: {
        Args: {
          p_clip_id: string
          p_reason?: string
          p_to_status: Database["public"]["Enums"]["clip_status"]
        }
        Returns: {
          caption: string
          cf_stream_uid: string | null
          comment_count: number
          created_at: string
          id: string
          likes_count: number
          owner_id: string
          playback_id: string | null
          rejection_reason: string | null
          sport: Database["public"]["Enums"]["sport"]
          status: Database["public"]["Enums"]["clip_status"]
          storage_path: string | null
          thumb_path: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_player_setup: {
        Args: {
          p_avatar_url: string
          p_city: string
          p_sports: Database["public"]["Enums"]["sport"][]
          p_state: string
        }
        Returns: undefined
      }
      consume_reservation: {
        Args: { p_payment_intent_id: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          payment_intent_id: string
          product_variant_id: string
          qty: number
          release_reason: string | null
          status: Database["public"]["Enums"]["stock_reservation_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_reservations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      court_booking_check_in: {
        Args: { p_booking_id: string }
        Returns: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          date: string
          gst: number
          id: string
          payment_intent_id: string | null
          platform_fee: number
          rating: number | null
          remarks: string | null
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        SetofOptions: {
          from: "*"
          to: "court_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      court_booking_confirm_payment: {
        Args: { p_booking_id: string; p_payment_intent_id: string }
        Returns: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          date: string
          gst: number
          id: string
          payment_intent_id: string | null
          platform_fee: number
          rating: number | null
          remarks: string | null
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        SetofOptions: {
          from: "*"
          to: "court_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      court_booking_expire_payment: {
        Args: { p_booking_id: string }
        Returns: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          date: string
          gst: number
          id: string
          payment_intent_id: string | null
          platform_fee: number
          rating: number | null
          remarks: string | null
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        SetofOptions: {
          from: "*"
          to: "court_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      court_booking_transition: {
        Args: {
          p_action: string
          p_booking_id: string
          p_new_date?: string
          p_new_slot_start?: string
          p_reason?: string
        }
        Returns: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          date: string
          gst: number
          id: string
          payment_intent_id: string | null
          platform_fee: number
          rating: number | null
          remarks: string | null
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        SetofOptions: {
          from: "*"
          to: "court_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      expire_stale_holds: { Args: never; Returns: Json }
      fail_transfer: {
        Args: {
          p_razorpay_transfer_id?: string
          p_reason?: string
          p_transfer_id: string
        }
        Returns: {
          amount: number
          created_at: string
          failure_reason: string | null
          id: string
          ledger_entry_group_id: string
          payout_account_id: string
          razorpay_transfer_id: string | null
          reversal_ledger_entry_group_id: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_coach_busy_slots: {
        Args: { p_coach_id: string; p_from: string; p_to: string }
        Returns: {
          date: string
          slot_start: string
        }[]
      }
      get_coach_wallet_balance: {
        Args: never
        Returns: {
          balance: number
          lifetime_earned: number
          lifetime_transferred: number
          this_month: number
        }[]
      }
      get_court_available_slots: {
        Args: { p_court_id: string; p_date: string }
        Returns: {
          price: number
          slot_end: string
          slot_start: string
        }[]
      }
      get_court_busy_slots: {
        Args: { p_court_id: string; p_from: string; p_to: string }
        Returns: {
          date: string
          slot_start: string
        }[]
      }
      get_court_rating_summary: {
        Args: { p_court_id: string }
        Returns: {
          rating: number
          rating_count: number
        }[]
      }
      get_my_transactions: {
        Args: { p_kind?: string; p_limit?: number; p_offset?: number }
        Returns: {
          amount: number
          description: string
          direction: string
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string
          id: string
          kind: string
          occurred_at: string
          status: string
        }[]
      }
      get_payout_account_balance: {
        Args: { p_payout_account_id: string }
        Returns: number
      }
      has_role: { Args: { _role: string }; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_court_partner_or_staff: {
        Args: { p_court_id: string }
        Returns: boolean
      }
      is_guest: { Args: never; Returns: boolean }
      is_moderator: { Args: never; Returns: boolean }
      is_verified_coach: { Args: { _coach_id: string }; Returns: boolean }
      moderate_clip: {
        Args: { p_action: string; p_clip_id: string; p_reason?: string }
        Returns: {
          caption: string
          cf_stream_uid: string | null
          comment_count: number
          created_at: string
          id: string
          likes_count: number
          owner_id: string
          playback_id: string | null
          rejection_reason: string | null
          sport: Database["public"]["Enums"]["sport"]
          status: Database["public"]["Enums"]["clip_status"]
          storage_path: string | null
          thumb_path: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "clips"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      order_transition: {
        Args: {
          p_actor_id?: string
          p_location?: string
          p_note?: string
          p_order_id: string
          p_to_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: {
          address_id: string | null
          created_at: string
          delivery_charges: number
          donation_roundup: number
          gst_and_others: number
          id: string
          order_number: string
          payment_intent_id: string | null
          ship_to_city: string
          ship_to_line1: string
          ship_to_line2: string | null
          ship_to_pincode: string
          ship_to_state: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      place_order_from_draft: {
        Args: { p_payment_intent_id: string }
        Returns: {
          address_id: string | null
          created_at: string
          delivery_charges: number
          donation_roundup: number
          gst_and_others: number
          id: string
          order_number: string
          payment_intent_id: string | null
          ship_to_city: string
          ship_to_line1: string
          ship_to_line2: string | null
          ship_to_pincode: string
          ship_to_state: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rate_court_booking: {
        Args: { p_booking_id: string; p_rating: number; p_remarks?: string }
        Returns: {
          booking_source: Database["public"]["Enums"]["booking_source"]
          cancellation_reason: string | null
          checked_in_at: string | null
          court_id: string
          created_at: string
          created_by_staff_id: string | null
          date: string
          gst: number
          id: string
          payment_intent_id: string | null
          platform_fee: number
          rating: number | null
          remarks: string | null
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["court_booking_status"]
          subtotal: number
          total: number
          updated_at: string
          user_id: string | null
          walk_in_name: string | null
          walk_in_phone: string | null
        }
        SetofOptions: {
          from: "*"
          to: "court_bookings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rate_session: {
        Args: { p_rating: number; p_remarks?: string; p_session_id: string }
        Returns: {
          cancellation_reason: string | null
          coach_id: string
          created_at: string
          date: string
          decline_reason: string | null
          focus_area: string | null
          frequency: Database["public"]["Enums"]["session_frequency"]
          id: string
          location: string | null
          payment_intent_id: string | null
          platform_fee: number
          player_id: string
          price: number
          rating: number | null
          remarks: string | null
          session_type_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["session_status"]
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reconcile_stranded_clips: { Args: never; Returns: Json }
      record_transfer: {
        Args: {
          p_amount: number
          p_payout_account_id: string
          p_razorpay_transfer_id: string
        }
        Returns: {
          amount: number
          created_at: string
          failure_reason: string | null
          id: string
          ledger_entry_group_id: string
          payout_account_id: string
          razorpay_transfer_id: string | null
          reversal_ledger_entry_group_id: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      release_expired_stock_reservations: { Args: never; Returns: number }
      release_reservation: {
        Args: { p_payment_intent_id: string; p_reason?: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          payment_intent_id: string
          product_variant_id: string
          qty: number
          release_reason: string | null
          status: Database["public"]["Enums"]["stock_reservation_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_reservations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reserve_stock_for_checkout: {
        Args: { p_lines: Json; p_payment_intent_id: string }
        Returns: {
          created_at: string
          expires_at: string
          id: string
          payment_intent_id: string
          product_variant_id: string
          qty: number
          release_reason: string | null
          status: Database["public"]["Enums"]["stock_reservation_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "stock_reservations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      resolve_report: {
        Args: { p_action: string; p_reason?: string; p_report_id: string }
        Returns: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          reason: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        SetofOptions: {
          from: "*"
          to: "reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      session_abandon_unpaid: {
        Args: { p_session_id: string }
        Returns: {
          cancellation_reason: string | null
          coach_id: string
          created_at: string
          date: string
          decline_reason: string | null
          focus_area: string | null
          frequency: Database["public"]["Enums"]["session_frequency"]
          id: string
          location: string | null
          payment_intent_id: string | null
          platform_fee: number
          player_id: string
          price: number
          rating: number | null
          remarks: string | null
          session_type_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["session_status"]
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      session_exists_between: {
        Args: { p_user_a: string; p_user_b: string }
        Returns: boolean
      }
      session_links_pair: {
        Args: { p_session_id: string; p_user_a: string; p_user_b: string }
        Returns: boolean
      }
      session_transition: {
        Args: {
          p_action: string
          p_new_date?: string
          p_new_slot_start?: string
          p_reason?: string
          p_session_id: string
        }
        Returns: {
          cancellation_reason: string | null
          coach_id: string
          created_at: string
          date: string
          decline_reason: string | null
          focus_area: string | null
          frequency: Database["public"]["Enums"]["session_frequency"]
          id: string
          location: string | null
          payment_intent_id: string | null
          platform_fee: number
          player_id: string
          price: number
          rating: number | null
          remarks: string | null
          session_type_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["session_status"]
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      session_transition_internal: {
        Args: {
          p_action: string
          p_actor_id: string
          p_new_date?: string
          p_new_slot_start?: string
          p_reason?: string
          p_session_id: string
        }
        Returns: {
          cancellation_reason: string | null
          coach_id: string
          created_at: string
          date: string
          decline_reason: string | null
          focus_area: string | null
          frequency: Database["public"]["Enums"]["session_frequency"]
          id: string
          location: string | null
          payment_intent_id: string | null
          platform_fee: number
          player_id: string
          price: number
          rating: number | null
          remarks: string | null
          session_type_id: string
          slot_end: string
          slot_start: string
          status: Database["public"]["Enums"]["session_status"]
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_refund: {
        Args: { p_razorpay_refund_id?: string; p_refund_id: string }
        Returns: {
          amount: number
          attempts: number
          created_at: string
          domain: Database["public"]["Enums"]["payment_domain"]
          entity_id: string
          failure_reason: string | null
          id: string
          ledger_entry_group_id: string | null
          payment_intent_id: string
          razorpay_refund_id: string | null
          status: Database["public"]["Enums"]["refund_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "refunds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_transfer: {
        Args: { p_razorpay_transfer_id?: string; p_transfer_id: string }
        Returns: {
          amount: number
          created_at: string
          failure_reason: string | null
          id: string
          ledger_entry_group_id: string
          payout_account_id: string
          razorpay_transfer_id: string | null
          reversal_ledger_entry_group_id: string | null
          status: Database["public"]["Enums"]["transfer_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "transfers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      stock_reservation_ttl: { Args: never; Returns: string }
      submit_coach_verification: { Args: { p_payload: Json }; Returns: string }
      submit_venue_verification: { Args: { p_payload: Json }; Returns: string }
      timemultirange: { Args: never; Returns: unknown }
      toggle_clip_like: { Args: { p_clip_id: string }; Returns: Json }
      toggle_follow: { Args: { p_followee_id: string }; Returns: Json }
      toggle_product_wishlist: {
        Args: { p_product_id: string }
        Returns: boolean
      }
      unpaid_hold_ttl: { Args: never; Returns: string }
      update_cart_item: {
        Args: { p_qty: number; p_variant_id: string }
        Returns: Database["public"]["CompositeTypes"]["cart_mutation_result"]
        SetofOptions: {
          from: "*"
          to: "cart_mutation_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      variant_available_stock: {
        Args: { p_variant_id: string }
        Returns: number
      }
    }
    Enums: {
      app_role:
        | "player"
        | "coach"
        | "court_partner"
        | "court_staff"
        | "upa"
        | "admin"
        | "moderator"
      applicant_type: "coach" | "venue" | "upa"
      booking_source: "self_service" | "walk_in"
      clip_status:
        | "uploading"
        | "processing"
        | "ready"
        | "published"
        | "rejected"
        | "removed"
      coach_status: "pending_review" | "verified" | "rejected"
      court_booking_status:
        | "confirmed"
        | "completed"
        | "cancelled"
        | "rescheduled"
        | "no_show"
        | "pending_payment"
        | "expired"
      fee_value_type: "percentage" | "flat"
      ledger_account_type:
        | "platform"
        | "coach"
        | "court_partner"
        | "upa_fund"
        | "user"
      ledger_direction: "debit" | "credit"
      notification_type:
        | "booking"
        | "order"
        | "chat"
        | "clip_moderation"
        | "donation"
        | "verification"
        | "transfer"
        | "support"
      order_status:
        | "placed"
        | "shipped"
        | "in_transit"
        | "delivered"
        | "cancelled"
      payment_domain: "session" | "court" | "commerce" | "donation" | "payout"
      payment_intent_status:
        | "created"
        | "authorized"
        | "captured"
        | "failed"
        | "refunded"
        | "partially_refunded"
      payout_account_status:
        | "not_started"
        | "pending"
        | "active"
        | "needs_attention"
        | "failed"
      refund_status: "pending" | "processed" | "failed"
      report_status: "pending" | "actioned" | "dismissed"
      session_frequency: "one_time" | "weekly" | "monthly"
      session_status:
        | "requested"
        | "accepted"
        | "declined"
        | "completed"
        | "cancelled"
        | "rescheduled"
        | "rated"
      sport: "football" | "cricket" | "badminton" | "tennis"
      stock_reservation_status: "held" | "consumed" | "released"
      ticket_status: "open" | "resolved"
      transfer_status: "processing" | "paid" | "failed"
      user_status: "active" | "suspended"
      venue_status: "pending" | "verified" | "rejected"
      verification_status: "pending_review" | "approved" | "rejected"
    }
    CompositeTypes: {
      cart_mutation_result: {
        cart_item_id: string | null
        product_variant_id: string | null
        qty: number | null
        requested_qty: number | null
        available_stock: number | null
        capped: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: [
        "player",
        "coach",
        "court_partner",
        "court_staff",
        "upa",
        "admin",
        "moderator",
      ],
      applicant_type: ["coach", "venue", "upa"],
      booking_source: ["self_service", "walk_in"],
      clip_status: [
        "uploading",
        "processing",
        "ready",
        "published",
        "rejected",
        "removed",
      ],
      coach_status: ["pending_review", "verified", "rejected"],
      court_booking_status: [
        "confirmed",
        "completed",
        "cancelled",
        "rescheduled",
        "no_show",
        "pending_payment",
        "expired",
      ],
      fee_value_type: ["percentage", "flat"],
      ledger_account_type: [
        "platform",
        "coach",
        "court_partner",
        "upa_fund",
        "user",
      ],
      ledger_direction: ["debit", "credit"],
      notification_type: [
        "booking",
        "order",
        "chat",
        "clip_moderation",
        "donation",
        "verification",
        "transfer",
        "support",
      ],
      order_status: [
        "placed",
        "shipped",
        "in_transit",
        "delivered",
        "cancelled",
      ],
      payment_domain: ["session", "court", "commerce", "donation", "payout"],
      payment_intent_status: [
        "created",
        "authorized",
        "captured",
        "failed",
        "refunded",
        "partially_refunded",
      ],
      payout_account_status: [
        "not_started",
        "pending",
        "active",
        "needs_attention",
        "failed",
      ],
      refund_status: ["pending", "processed", "failed"],
      report_status: ["pending", "actioned", "dismissed"],
      session_frequency: ["one_time", "weekly", "monthly"],
      session_status: [
        "requested",
        "accepted",
        "declined",
        "completed",
        "cancelled",
        "rescheduled",
        "rated",
      ],
      sport: ["football", "cricket", "badminton", "tennis"],
      stock_reservation_status: ["held", "consumed", "released"],
      ticket_status: ["open", "resolved"],
      transfer_status: ["processing", "paid", "failed"],
      user_status: ["active", "suspended"],
      venue_status: ["pending", "verified", "rejected"],
      verification_status: ["pending_review", "approved", "rejected"],
    },
  },
} as const


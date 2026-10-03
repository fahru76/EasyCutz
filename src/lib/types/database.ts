/**
 * Supabase database types for EasyCutz.
 *
 * Mirrors supabase/migrations/*.sql in the exact shape produced by
 * `supabase gen types typescript`. If you change the schema, regenerate with:
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/lib/types/database.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type ServiceCategory = "haircut" | "beard_shave" | "combo" | "scalp";
type TicketStatus = "waiting" | "called" | "in_chair" | "completed" | "no_show" | "cancelled";
type AppointmentStatus =
  | "pending_payment"
  | "confirmed"
  | "checked_in"
  | "called"
  | "in_chair"
  | "completed"
  | "no_show"
  | "cancelled"
  | "expired";
type PaymentOption = "cash_on_site" | "deposit" | "full";
type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";
type BookingKind = "appointment" | "ticket";
type StaffRole = "owner" | "host" | "barber";
export type RescheduleReason = "delay" | "closure" | "barber_unavailable" | "early" | "manual";
export type ClosureReason = "power" | "weather" | "illness" | "emergency" | "other";
export type TicketCancelReason = "customer" | "shop_closed" | "staff";
export type ClosureImpactAction = "ticket_cancelled" | "appointment_affected" | "hold_released";

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      shop_settings: {
        Row: {
          id: number;
          shop_name: string;
          timezone: string;
          currency: string;
          slot_interval_min: number;
          booking_horizon_days: number;
          min_lead_min: number;
          hold_minutes: number;
          deposit_percent: number;
          min_deposit_cents: number;
          notify_lead_min: number;
          delay_notify_min: number;
          early_offer_min: number;
          reschedule_cutoff_min: number;
          offer_hold_hours: number;
          closed_until: string | null;
          closure_message: string | null;
          closure_reason: ClosureReason | null;
          shop_phone: string | null;
          shop_address: string | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          shop_name?: string;
          timezone?: string;
          currency?: string;
          slot_interval_min?: number;
          booking_horizon_days?: number;
          min_lead_min?: number;
          hold_minutes?: number;
          deposit_percent?: number;
          min_deposit_cents?: number;
          notify_lead_min?: number;
          delay_notify_min?: number;
          early_offer_min?: number;
          reschedule_cutoff_min?: number;
          offer_hold_hours?: number;
          closed_until?: string | null;
          closure_message?: string | null;
          closure_reason?: ClosureReason | null;
          shop_phone?: string | null;
          shop_address?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["shop_settings"]["Insert"]>;
        Relationships: [];
      };
      services: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string;
          category: ServiceCategory;
          duration_min: number;
          price_cents: number;
          is_popular: boolean;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string;
          category: ServiceCategory;
          duration_min: number;
          price_cents: number;
          is_popular?: boolean;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["services"]["Insert"]>;
        Relationships: [];
      };
      addons: {
        Row: {
          id: string;
          slug: string;
          name: string;
          description: string;
          duration_min: number;
          price_cents: number;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name: string;
          description?: string;
          duration_min?: number;
          price_cents: number;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["addons"]["Insert"]>;
        Relationships: [];
      };
      barbers: {
        Row: {
          id: string;
          slug: string;
          display_name: string;
          specialty: string;
          bio: string;
          avatar_url: string | null;
          rating: number;
          review_count: number;
          ticket_prefix: string;
          is_on_duty: boolean;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          display_name: string;
          specialty?: string;
          bio?: string;
          avatar_url?: string | null;
          rating?: number;
          review_count?: number;
          ticket_prefix: string;
          is_on_duty?: boolean;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["barbers"]["Insert"]>;
        Relationships: [];
      };
      barber_shifts: {
        Row: {
          id: string;
          barber_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
        };
        Insert: {
          id?: string;
          barber_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
        };
        Update: Partial<Database["public"]["Tables"]["barber_shifts"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "barber_shifts_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
        ];
      };
      barber_time_off: {
        Row: {
          id: string;
          barber_id: string;
          starts_at: string;
          ends_at: string;
          reason: string;
        };
        Insert: {
          id?: string;
          barber_id: string;
          starts_at: string;
          ends_at: string;
          reason?: string;
        };
        Update: Partial<Database["public"]["Tables"]["barber_time_off"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "barber_time_off_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
        ];
      };
      staff: {
        Row: {
          user_id: string;
          barber_id: string | null;
          role: StaffRole;
          display_name: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          barber_id?: string | null;
          role?: StaffRole;
          display_name: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff"]["Insert"]>;
        Relationships: [];
      };
      appointments: {
        Row: {
          id: string;
          barber_id: string;
          starts_at: string;
          ends_at: string;
          duration_min: number;
          price_cents: number;
          service_ids: string[];
          addon_ids: string[];
          service_summary: string;
          display_name: string;
          status: AppointmentStatus;
          payment_option: PaymentOption;
          payment_status: PaymentStatus;
          amount_due_now_cents: number;
          hold_expires_at: string | null;
          expected_end_at: string | null;
          delay_notified_at: string | null;
          delay_notified_min: number | null;
          reschedule_requested_at: string | null;
          checked_in_at: string | null;
          called_at: string | null;
          seated_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          barber_id: string;
          starts_at: string;
          ends_at: string;
          duration_min: number;
          price_cents: number;
          service_ids: string[];
          addon_ids?: string[];
          service_summary: string;
          display_name: string;
          status?: AppointmentStatus;
          payment_option?: PaymentOption;
          payment_status?: PaymentStatus;
          amount_due_now_cents?: number;
          hold_expires_at?: string | null;
          expected_end_at?: string | null;
          delay_notified_at?: string | null;
          delay_notified_min?: number | null;
          reschedule_requested_at?: string | null;
          checked_in_at?: string | null;
          called_at?: string | null;
          seated_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["appointments"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "appointments_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
        ];
      };
      queue_tickets: {
        Row: {
          id: string;
          shop_day: string;
          ticket_number: number;
          code: string;
          preferred_barber_id: string | null;
          barber_id: string | null;
          status: TicketStatus;
          duration_min: number;
          price_cents: number;
          service_ids: string[];
          addon_ids: string[];
          service_summary: string;
          display_name: string;
          payment_option: PaymentOption;
          payment_status: PaymentStatus;
          amount_due_now_cents: number;
          checked_in_at: string | null;
          notified_at: string | null;
          cancel_reason: TicketCancelReason | null;
          expected_end_at: string | null;
          called_at: string | null;
          seated_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          shop_day: string;
          ticket_number: number;
          code: string;
          preferred_barber_id?: string | null;
          barber_id?: string | null;
          status?: TicketStatus;
          duration_min: number;
          price_cents: number;
          service_ids: string[];
          addon_ids?: string[];
          service_summary: string;
          display_name: string;
          payment_option?: PaymentOption;
          payment_status?: PaymentStatus;
          amount_due_now_cents?: number;
          checked_in_at?: string | null;
          notified_at?: string | null;
          cancel_reason?: TicketCancelReason | null;
          expected_end_at?: string | null;
          called_at?: string | null;
          seated_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["queue_tickets"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "queue_tickets_barber_id_fkey";
            columns: ["barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "queue_tickets_preferred_barber_id_fkey";
            columns: ["preferred_barber_id"];
            isOneToOne: false;
            referencedRelation: "barbers";
            referencedColumns: ["id"];
          },
        ];
      };
      booking_private: {
        Row: {
          id: string;
          kind: BookingKind;
          appointment_id: string | null;
          ticket_id: string | null;
          access_token: string;
          customer_name: string;
          phone: string;
          email: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          kind: BookingKind;
          appointment_id?: string | null;
          ticket_id?: string | null;
          access_token?: string;
          customer_name: string;
          phone: string;
          email?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_private"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "booking_private_appointment_id_fkey";
            columns: ["appointment_id"];
            isOneToOne: true;
            referencedRelation: "appointments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "booking_private_ticket_id_fkey";
            columns: ["ticket_id"];
            isOneToOne: true;
            referencedRelation: "queue_tickets";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          kind: BookingKind;
          appointment_id: string | null;
          ticket_id: string | null;
          stripe_checkout_session_id: string;
          stripe_payment_intent_id: string | null;
          amount_cents: number;
          currency: string;
          status: PaymentStatus;
          needs_refund: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          kind: BookingKind;
          appointment_id?: string | null;
          ticket_id?: string | null;
          stripe_checkout_session_id: string;
          stripe_payment_intent_id?: string | null;
          amount_cents: number;
          currency: string;
          status?: PaymentStatus;
          needs_refund?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [];
      };
      reschedule_offers: {
        Row: {
          id: string;
          appointment_id: string;
          barber_id: string;
          starts_at: string;
          ends_at: string;
          reason: RescheduleReason;
          status: "open" | "accepted" | "released" | "expired";
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          appointment_id: string;
          barber_id: string;
          starts_at: string;
          ends_at: string;
          reason: RescheduleReason;
          status?: "open" | "accepted" | "released" | "expired";
          expires_at: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["reschedule_offers"]["Insert"]>;
        Relationships: [];
      };
      booking_events: {
        Row: {
          id: string;
          appointment_id: string | null;
          ticket_id: string | null;
          kind: "rescheduled" | "reschedule_requested" | "offers_created" | "offers_released";
          actor: "customer" | "staff" | "system";
          actor_user: string | null;
          data: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          appointment_id?: string | null;
          ticket_id?: string | null;
          kind: "rescheduled" | "reschedule_requested" | "offers_created" | "offers_released";
          actor: "customer" | "staff" | "system";
          actor_user?: string | null;
          data?: Json;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["booking_events"]["Insert"]>;
        Relationships: [];
      };
      catalog_changes: {
        Row: {
          id: string;
          changed_by: string | null;
          changed_at: string;
          table_name: "services" | "addons" | "shop_settings";
          row_id: string;
          action: "create" | "update" | "activate" | "deactivate" | "reorder";
          before: Json | null;
          after: Json | null;
        };
        Insert: {
          id?: string;
          changed_by?: string | null;
          changed_at?: string;
          table_name: "services" | "addons" | "shop_settings";
          row_id: string;
          action: "create" | "update" | "activate" | "deactivate" | "reorder";
          before?: Json | null;
          after?: Json | null;
        };
        Update: Partial<Database["public"]["Tables"]["catalog_changes"]["Insert"]>;
        Relationships: [];
      };
      shop_closures: {
        Row: {
          id: string;
          starts_at: string;
          ends_at: string;
          planned_ends_at: string;
          reason: ClosureReason;
          public_message: string;
          created_by: string | null;
          created_at: string;
          reopened_at: string | null;
          reopened_by: string | null;
        };
        Insert: {
          id?: string;
          starts_at?: string;
          ends_at: string;
          planned_ends_at: string;
          reason: ClosureReason;
          public_message: string;
          created_by?: string | null;
          created_at?: string;
          reopened_at?: string | null;
          reopened_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["shop_closures"]["Insert"]>;
        Relationships: [];
      };
      closure_impacts: {
        Row: {
          id: string;
          closure_id: string;
          appointment_id: string | null;
          ticket_id: string | null;
          action: ClosureImpactAction;
          had_payment: boolean;
          notified_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          closure_id: string;
          appointment_id?: string | null;
          ticket_id?: string | null;
          action: ClosureImpactAction;
          had_payment?: boolean;
          notified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["closure_impacts"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      shop_tz: { Args: never; Returns: string };
      shop_today: { Args: never; Returns: string };
      is_staff: { Args: never; Returns: boolean };
      expire_stale_holds: { Args: never; Returns: number };
      issue_queue_ticket: {
        Args: {
          p_preferred_barber_id: string | null;
          p_service_ids: string[];
          p_addon_ids: string[];
          p_customer_name: string;
          p_phone: string;
          p_email: string | null;
          p_payment_option: PaymentOption;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      book_appointment: {
        Args: {
          p_barber_id: string | null;
          p_starts_at: string;
          p_service_ids: string[];
          p_addon_ids: string[];
          p_customer_name: string;
          p_phone: string;
          p_email: string | null;
          p_payment_option: PaymentOption;
          p_notes?: string | null;
        };
        Returns: Json;
      };
      cancel_booking: { Args: { p_token: string }; Returns: Json };
      apply_checkout_result: {
        Args: { p_session_id: string; p_paid: boolean; p_payment_intent_id: string | null };
        Returns: Json;
      };
      desk_call_next: { Args: { p_barber_id: string }; Returns: Json };
      desk_transition: {
        Args: { p_kind: BookingKind; p_id: string; p_action: string; p_barber_id?: string | null };
        Returns: undefined;
      };
      desk_check_in: { Args: { p_token: string }; Returns: Json };
      desk_mark_notified: { Args: { p_ticket_id: string }; Returns: undefined };
      desk_set_expected_end: {
        Args: { p_kind: BookingKind; p_id: string; p_mode: "extend" | "finish_in"; p_minutes: number };
        Returns: string;
      };
      desk_mark_delay_notified: { Args: { p_appointment_id: string; p_delay_min: number }; Returns: undefined };
      chair_free_at: { Args: { p_barber_id: string }; Returns: string };
      is_owner: { Args: never; Returns: boolean };
      admin_save_service: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_description: string;
          p_category: ServiceCategory;
          p_duration_min: number;
          p_price_cents: number;
          p_is_popular: boolean;
          p_is_active: boolean;
        };
        Returns: string;
      };
      admin_save_addon: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_description: string;
          p_duration_min: number;
          p_price_cents: number;
          p_is_active: boolean;
        };
        Returns: string;
      };
      admin_reorder: { Args: { p_table: "services" | "addons"; p_ids: string[] }; Returns: undefined };
      admin_update_settings: { Args: { p_patch: Json }; Returns: undefined };
      reschedule_by_token: {
        Args: { p_token: string; p_starts_at: string | null; p_barber_id: string | null; p_offer_id: string | null };
        Returns: Json;
      };
      desk_reschedule: {
        Args: { p_appointment_id: string; p_starts_at: string | null; p_barber_id: string | null; p_offer_id?: string | null };
        Returns: Json;
      };
      create_reschedule_offers: {
        Args: { p_appointment_id: string; p_reason: RescheduleReason; p_offers: Json };
        Returns: Json;
      };
      desk_set_duty: { Args: { p_barber_id: string; p_on_duty: boolean }; Returns: undefined };
      shop_closed_now: { Args: never; Returns: boolean };
      closure_overlapping: { Args: { p_starts_at: string; p_ends_at: string }; Returns: string | null };
      desk_close_shop: { Args: { p_until: string; p_reason: ClosureReason; p_message: string }; Returns: Json };
      desk_reopen_shop: { Args: never; Returns: Json };
      desk_mark_closure_notified: { Args: { p_impact_id: string }; Returns: undefined };
      desk_cancel_affected: { Args: { p_impact_id: string }; Returns: Json };
    };
    Enums: {
      service_category: ServiceCategory;
      ticket_status: TicketStatus;
      appointment_status: AppointmentStatus;
      payment_option: PaymentOption;
      payment_status: PaymentStatus;
      booking_kind: BookingKind;
      staff_role: StaffRole;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database["public"];
export type TableRow<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type DbEnum<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

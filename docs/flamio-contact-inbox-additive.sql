BEGIN;

ALTER TABLE public.restaurant_settings
  ADD COLUMN IF NOT EXISTS owner_phone text,
  ADD COLUMN IF NOT EXISTS messenger_url text,
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS contact_call_restaurant_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_call_owner_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_inbox_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_facebook_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS contact_messenger_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_whatsapp_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.customer_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_user_id)
);
GRANT SELECT, INSERT, UPDATE ON public.customer_conversations TO authenticated;
GRANT ALL ON public.customer_conversations TO service_role;
ALTER TABLE public.customer_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Customers can view their own conversation" ON public.customer_conversations;
CREATE POLICY "Customers can view their own conversation"
  ON public.customer_conversations FOR SELECT TO authenticated
  USING (auth.uid() = customer_user_id);
DROP POLICY IF EXISTS "Customers can create their own conversation" ON public.customer_conversations;
CREATE POLICY "Customers can create their own conversation"
  ON public.customer_conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_user_id);
DROP POLICY IF EXISTS "Customers can update their own conversation" ON public.customer_conversations;
CREATE POLICY "Customers can update their own conversation"
  ON public.customer_conversations FOR UPDATE TO authenticated
  USING (auth.uid() = customer_user_id)
  WITH CHECK (auth.uid() = customer_user_id);

CREATE TABLE IF NOT EXISTS public.customer_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.customer_conversations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('customer', 'staff')),
  sender_name text,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  read_by_customer boolean NOT NULL DEFAULT false,
  read_by_staff boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.customer_conversation_messages TO authenticated;
GRANT UPDATE (read_by_customer) ON public.customer_conversation_messages TO authenticated;
GRANT ALL ON public.customer_conversation_messages TO service_role;
ALTER TABLE public.customer_conversation_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Customers can view messages in their conversation" ON public.customer_conversation_messages;
CREATE POLICY "Customers can view messages in their conversation"
  ON public.customer_conversation_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_conversations c
    WHERE c.id = conversation_id AND c.customer_user_id = auth.uid()
  ));
DROP POLICY IF EXISTS "Customers can send messages in their conversation" ON public.customer_conversation_messages;
CREATE POLICY "Customers can send messages in their conversation"
  ON public.customer_conversation_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND sender_role = 'customer'
    AND EXISTS (
      SELECT 1 FROM public.customer_conversations c
      WHERE c.id = conversation_id AND c.customer_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Customers can mark messages in their conversation" ON public.customer_conversation_messages;
CREATE POLICY "Customers can mark messages in their conversation"
  ON public.customer_conversation_messages FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.customer_conversations c
    WHERE c.id = conversation_id AND c.customer_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.customer_conversations c
    WHERE c.id = conversation_id AND c.customer_user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS customer_conversations_last_message_idx
  ON public.customer_conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS customer_conversation_messages_thread_idx
  ON public.customer_conversation_messages (conversation_id, created_at);

COMMIT;

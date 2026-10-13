-- ============ Challenge engine ============

CREATE TABLE public.challenge_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled boolean NOT NULL DEFAULT true,
  ticker_enabled boolean NOT NULL DEFAULT true,
  ticker_max_winners integer NOT NULL DEFAULT 10,
  ticker_duration_seconds integer NOT NULL DEFAULT 4,
  winner_retention_days integer NOT NULL DEFAULT 30,
  auto_cleanup_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.challenge_settings TO authenticated;
GRANT SELECT ON public.challenge_settings TO anon;
GRANT ALL ON public.challenge_settings TO service_role;
ALTER TABLE public.challenge_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Challenge settings are readable" ON public.challenge_settings FOR SELECT USING (true);
CREATE TRIGGER update_challenge_settings_updated_at BEFORE UPDATE ON public.challenge_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.challenge_settings (is_enabled) VALUES (true);

CREATE TABLE public.challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  instructions text,
  game_type text NOT NULL,
  detector_type text NOT NULL,
  icon_emoji text NOT NULL DEFAULT '🎮',
  banner_path text,
  difficulty text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'draft',

  starts_on date,
  ends_on date,
  daily_start_time text,
  daily_end_time text,

  attempts_per_session integer NOT NULL DEFAULT 1,
  required_score numeric NOT NULL DEFAULT 0,
  required_accuracy numeric,
  time_limit_seconds integer,
  winning_condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_config jsonb NOT NULL DEFAULT '{}'::jsonb,

  reward_type text NOT NULL DEFAULT 'free_item',
  reward_name text NOT NULL DEFAULT 'Flamio reward',
  reward_quantity integer NOT NULL DEFAULT 1,
  reward_coupon_id uuid REFERENCES public.coupons(id) ON DELETE SET NULL,
  reward_points integer NOT NULL DEFAULT 0,

  base_plays integer NOT NULL DEFAULT 1,
  max_stored_plays integer NOT NULL DEFAULT 1,
  max_plays_per_customer integer NOT NULL DEFAULT 0,
  cooldown_minutes integer NOT NULL DEFAULT 0,

  refill_enabled boolean NOT NULL DEFAULT false,
  refill_interval_minutes integer NOT NULL DEFAULT 1440,
  refill_amount integer NOT NULL DEFAULT 1,

  order_unlock_enabled boolean NOT NULL DEFAULT false,
  order_min_amount numeric NOT NULL DEFAULT 0,
  order_unlock_plays integer NOT NULL DEFAULT 1,
  order_unlock_max integer NOT NULL DEFAULT 0,
  order_unlock_stack boolean NOT NULL DEFAULT true,
  order_required_status text NOT NULL DEFAULT 'completed',

  referral_unlock_enabled boolean NOT NULL DEFAULT false,
  referral_required_count integer NOT NULL DEFAULT 10,
  referral_unlock_plays integer NOT NULL DEFAULT 1,
  referral_unlock_max integer NOT NULL DEFAULT 0,
  referral_cooldown_hours integer NOT NULL DEFAULT 0,
  referral_verification text NOT NULL DEFAULT 'approved_claim',

  daily_winner_limit integer NOT NULL DEFAULT 0,
  total_winner_limit integer NOT NULL DEFAULT 0,
  max_wins_per_customer integer NOT NULL DEFAULT 1,

  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.challenges TO authenticated;
GRANT ALL ON public.challenges TO service_role;
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Playable challenges are readable" ON public.challenges
  FOR SELECT TO authenticated USING (status IN ('active', 'scheduled', 'paused'));
CREATE TRIGGER update_challenges_updated_at BEFORE UPDATE ON public.challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.challenge_play_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source text NOT NULL,
  plays integer NOT NULL DEFAULT 1,
  reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, user_id, source, reference)
);

GRANT SELECT ON public.challenge_play_grants TO authenticated;
GRANT ALL ON public.challenge_play_grants TO service_role;
ALTER TABLE public.challenge_play_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read their own play grants" ON public.challenge_play_grants
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX challenge_play_grants_lookup ON public.challenge_play_grants (challenge_id, user_id);

CREATE TABLE public.challenge_play_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plays_used integer NOT NULL DEFAULT 0,
  last_play_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (challenge_id, user_id)
);

GRANT SELECT ON public.challenge_play_state TO authenticated;
GRANT ALL ON public.challenge_play_state TO service_role;
ALTER TABLE public.challenge_play_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read their own play state" ON public.challenge_play_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_challenge_play_state_updated_at BEFORE UPDATE ON public.challenge_play_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.challenge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress',
  score numeric NOT NULL DEFAULT 0,
  seed text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.challenge_sessions TO authenticated;
GRANT ALL ON public.challenge_sessions TO service_role;
ALTER TABLE public.challenge_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read their own sessions" ON public.challenge_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX challenge_sessions_lookup ON public.challenge_sessions (challenge_id, user_id, status);

CREATE TABLE public.challenge_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.challenge_sessions(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_type text NOT NULL,
  reward_name text NOT NULL,
  reward_quantity integer NOT NULL DEFAULT 1,
  coupon_code text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_status text NOT NULL DEFAULT 'pending',
  is_hidden boolean NOT NULL DEFAULT false,
  won_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);

GRANT SELECT ON public.challenge_winners TO authenticated;
GRANT ALL ON public.challenge_winners TO service_role;
ALTER TABLE public.challenge_winners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read their own wins" ON public.challenge_winners
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX challenge_winners_recent ON public.challenge_winners (won_at DESC);
CREATE INDEX challenge_winners_challenge ON public.challenge_winners (challenge_id, won_at DESC);

-- ============ Seed challenge definitions ============
INSERT INTO public.challenges
  (slug, name, description, instructions, game_type, detector_type, icon_emoji, difficulty, status,
   attempts_per_session, required_score, time_limit_seconds, winning_condition, difficulty_config,
   reward_type, reward_name, reward_quantity,
   base_plays, max_stored_plays, max_plays_per_customer, cooldown_minutes,
   refill_enabled, refill_interval_minutes, refill_amount,
   order_unlock_enabled, order_min_amount, order_unlock_plays, order_unlock_max, order_unlock_stack,
   referral_unlock_enabled, referral_required_count, referral_unlock_plays,
   daily_winner_limit, total_winner_limit, max_wins_per_customer, sort_order)
VALUES
  ('bottle-flip', 'Bottle Flip Challenge', 'Flip the bottle and land it upright three times.',
   'Record yourself flipping a bottle. Camera-based automatic detection is not available yet, so this challenge stays a draft until staff verification is set up.',
   'physical', 'bottle_flip_detector', '🍼', 'hard', 'draft',
   3, 3, NULL, '{"successful_landings":3}'::jsonb, '{}'::jsonb,
   'free_item', 'Free Flamio Classic Burger', 1,
   1, 2, 0, 0,
   true, 1440, 1,
   true, 200, 1, 0, true,
   true, 10, 1,
   5, 0, 1, 1),

  ('double-dice', 'Double Dice Challenge', 'Roll two dice and hit the winning combination.',
   'Tap to roll. Both dice are rolled securely on our server, so every roll is fair.',
   'chance', 'dice_detector', '🎲', 'hard', 'active',
   1, 0, NULL, '{"type":"double","value":6}'::jsonb, '{}'::jsonb,
   'free_item', 'Free Flamio Classic Burger', 1,
   1, 2, 0, 0,
   true, 1440, 1,
   true, 300, 1, 0, true,
   false, 10, 1,
   3, 0, 1, 2),

  ('lucky-coin', 'Lucky Coin Challenge', 'Toss the coin and match the winning streak.',
   'Tap to toss. Tosses are generated securely on our server.',
   'chance', 'coin_detector', '🪙', 'hard', 'draft',
   1, 0, NULL, '{"tosses":5,"required_heads":5}'::jsonb, '{}'::jsonb,
   'free_item', 'Free Soft Drink', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   false, 0, 1, 0, true,
   false, 10, 1,
   5, 0, 1, 3),

  ('lightning-tap', 'Lightning Tap', 'How fast can you react? Tap the moment the screen turns hot.',
   'Wait for the signal, then tap as fast as you can. Beat the target reaction time in every round.',
   'mini_game', 'reaction_game', '⚡', 'hard', 'active',
   1, 3, 30, '{"rounds":3,"max_reaction_ms":260}'::jsonb, '{"rounds":3,"max_reaction_ms":260}'::jsonb,
   'free_item', 'Free Flamio Classic Burger', 1,
   1, 2, 0, 0,
   true, 1440, 1,
   true, 200, 1, 0, true,
   true, 10, 1,
   5, 0, 1, 4),

  ('perfect-stop', 'Perfect Stop', 'Stop the moving marker inside the tiny target zone.',
   'Tap STOP when the marker is inside the highlighted zone. Nail it every round to win.',
   'mini_game', 'timing_game', '🎯', 'hard', 'active',
   1, 2, 30, '{"rounds":2,"zone_width":7,"speed":1.6}'::jsonb, '{"rounds":2,"zone_width":7,"speed":1.6}'::jsonb,
   'free_item', 'Free Fries', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   false, 0, 1, 0, true,
   false, 10, 1,
   5, 0, 1, 5),

  ('memory-flash', 'Memory Flash', 'Memorise the pattern and repeat it back.',
   'Watch the tiles flash, then tap them in the same order.',
   'mini_game', 'memory_game', '🧠', 'hard', 'draft',
   1, 5, 60, '{"sequence_length":5}'::jsonb, '{"sequence_length":5}'::jsonb,
   'free_item', 'Free Soft Drink', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   false, 0, 1, 0, true,
   false, 10, 1,
   5, 0, 1, 6),

  ('dont-tap-the-bomb', 'Don''t Tap the Bomb', 'Tap the burgers, avoid the bombs.',
   'Tap every burger that appears and never touch a bomb.',
   'mini_game', 'avoid_game', '💥', 'hard', 'draft',
   1, 12, 25, '{"target_score":12,"spawn_ms":800,"bomb_ratio":0.35}'::jsonb, '{"target_score":12,"spawn_ms":800,"bomb_ratio":0.35}'::jsonb,
   'free_item', 'Free Fries', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   false, 0, 1, 0, true,
   false, 10, 1,
   5, 0, 1, 7),

  ('spinning-target', 'Spinning Target', 'Stop the spinner on the hot zone.',
   'Tap when the rotating pointer crosses the highlighted arc.',
   'mini_game', 'timing_game', '🌀', 'hard', 'draft',
   1, 2, 30, '{"rounds":2,"zone_width":9,"speed":2.1}'::jsonb, '{"rounds":2,"zone_width":9,"speed":2.1}'::jsonb,
   'free_item', 'Free Soft Drink', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   false, 0, 1, 0, true,
   false, 10, 1,
   5, 0, 1, 8),

  ('number-rush', 'Number Rush', 'Tap the numbers in order before time runs out.',
   'Tap 1 to 12 in the right order as fast as you can.',
   'mini_game', 'sequence_game', '🔢', 'hard', 'draft',
   1, 12, 20, '{"count":12}'::jsonb, '{"count":12}'::jsonb,
   'free_item', 'Free Fries', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   false, 0, 1, 0, true,
   false, 10, 1,
   5, 0, 1, 9),

  ('burger-stack', 'Burger Stack', 'Stack the Flamio ingredients perfectly.',
   'Tap to drop each ingredient. Keep the stack aligned to reach the target height.',
   'mini_game', 'stack_game', '🍔', 'hard', 'draft',
   1, 6, 60, '{"target_layers":6,"speed":2.2,"tolerance":16}'::jsonb, '{"target_layers":6,"speed":2.2,"tolerance":16}'::jsonb,
   'free_item', 'Free Flamio Classic Burger', 1,
   1, 1, 0, 0,
   true, 1440, 1,
   true, 200, 1, 0, true,
   false, 10, 1,
   3, 0, 1, 10);
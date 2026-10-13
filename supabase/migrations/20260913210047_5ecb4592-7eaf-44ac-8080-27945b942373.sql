REVOKE ALL ON FUNCTION public.award_completed_order_reward() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_completed_order_reward() TO service_role;
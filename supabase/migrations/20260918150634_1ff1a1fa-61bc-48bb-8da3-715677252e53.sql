DELETE FROM public.inventory_movements WHERE order_id IN (SELECT id FROM public.orders WHERE platform_name = 'QA Foodi');
DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE platform_name = 'QA Foodi');
DELETE FROM public.notifications WHERE order_id IN (SELECT id FROM public.orders WHERE platform_name = 'QA Foodi');
DELETE FROM public.orders WHERE platform_name = 'QA Foodi';
DELETE FROM public.platform_product_prices WHERE platform_id IN (SELECT id FROM public.sales_platforms WHERE name = 'QA Foodi');
DELETE FROM public.sales_platforms WHERE name = 'QA Foodi';
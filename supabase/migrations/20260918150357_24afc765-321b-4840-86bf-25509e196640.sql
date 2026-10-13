UPDATE public.sales_platforms SET pricing_mode = 'custom' WHERE name = 'QA Foodi';
UPDATE public.platform_product_prices SET price = 75
 WHERE platform_id = (SELECT id FROM public.sales_platforms WHERE name = 'QA Foodi')
   AND product_id = (SELECT id FROM public.products WHERE name = 'Flamio Classic Burger');
DELETE FROM public.platform_product_prices
 WHERE platform_id = (SELECT id FROM public.sales_platforms WHERE name = 'QA Foodi')
   AND product_id <> (SELECT id FROM public.products WHERE name = 'Flamio Classic Burger');
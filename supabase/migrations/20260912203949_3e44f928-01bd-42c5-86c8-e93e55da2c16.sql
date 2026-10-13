
INSERT INTO public.categories (slug, name, description, is_visible, sort_order) VALUES
 ('burger','Burger','Flame-grilled patties in soft toasted buns.',true,1),
 ('meat-box','Meat Box','Loaded boxes built for real hunger.',true,2),
 ('pizza','Pizza','Stone-baked, generously topped.',true,3),
 ('pasta','Pasta','Oven baked and cheesy.',true,4),
 ('shawarma-and-sides','Shawarma & Sides','Wraps, wings and crunchy sides.',true,5)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.products (category_id, slug, name, base_price, badges, is_available, is_featured, is_popular, sort_order)
SELECT c.id, v.slug, v.name, v.price, v.badges::text[], true, v.featured, v.popular, v.sort_order
FROM (VALUES
 ('burger','flamio-classic-burger','Flamio Classic Burger',60,'{}',false,true,1),
 ('burger','naga-fire-burger','Naga Fire Burger',70,'{spicy}',false,false,2),
 ('burger','crispy-chicken-burger','Crispy Chicken Burger',70,'{}',false,true,3),
 ('burger','cheesy-blast-burger','Cheesy Blast Burger',90,'{}',false,false,4),
 ('burger','flamio-special-burger','Flamio Special Burger',99,'{}',true,true,5),
 ('burger','crispy-cheese-crunch','Crispy Cheese Crunch',110,'{}',false,false,6),
 ('burger','bbq-cheese-burst-burger','BBQ Cheese Burst Burger',120,'{}',true,false,7),
 ('meat-box','mini-meat-box','Mini Meat Box',99,'{}',false,true,1),
 ('meat-box','mini-naga-meat-box','Mini Naga Meat Box',120,'{spicy}',false,false,2),
 ('meat-box','bbq-meat-box','BBQ Meat Box',120,'{}',false,false,3),
 ('meat-box','regular-meat-box','Regular Meat Box',150,'{}',false,false,4),
 ('meat-box','flamio-special-meat-box','Flamio Special Meat Box',199,'{}',true,true,5),
 ('meat-box','full-chicken-meat-box','Full Chicken Meat Box',250,'{}',false,false,6),
 ('pizza','italian-margherita-classica','Italian Margherita Classica',200,'{}',false,true,1),
 ('pizza','savory-sausage','Savory Sausage',250,'{}',false,false,2),
 ('pizza','bbq-chicken-supreme','BBQ Chicken Supreme',280,'{}',true,true,3),
 ('pizza','meat-lovers-deluxe','Meat Lovers Deluxe',300,'{}',false,false,4),
 ('pizza','pepperoni-blast','Pepperoni Blast',330,'{}',false,false,5),
 ('pizza','italiano-flamio-special','Italiano Flamio Special',400,'{}',true,false,6),
 ('pasta','oven-baked-pasta','Oven Baked Pasta',150,'{}',false,true,1),
 ('shawarma-and-sides','chicken-shawarma','Chicken Shawarma',99,'{}',true,true,1),
 ('shawarma-and-sides','nachos','Nachos',110,'{}',false,false,2),
 ('shawarma-and-sides','bbq-wings-4-pcs','BBQ Wings (4 Pcs)',140,'{}',false,true,3),
 ('shawarma-and-sides','chicken-lollipop-6-pcs','Chicken Lollipop (6 Pcs)',140,'{}',false,false,4)
) AS v(cat_slug, slug, name, price, badges, featured, popular, sort_order)
JOIN public.categories c ON c.slug = v.cat_slug
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.product_images (product_id, url, alt, is_primary, sort_order)
SELECT p.id, NULL, p.name || ' at Flamio', true, 1
FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.product_images i WHERE i.product_id = p.id);

INSERT INTO public.restaurant_settings (name, tagline, address_line, city, country, is_open)
SELECT 'Flamio', 'Flame-grilled. Freshly built. Seriously good.', 'Kishoreganj Sadar, Gurudayal College', 'Kishoreganj', 'Bangladesh', true
WHERE NOT EXISTS (SELECT 1 FROM public.restaurant_settings);

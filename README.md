# Flamio Ordering Foundation

Build Phase 1 of a premium restaurant web application called Flamio Smart Restaurant OS.

IMPORTANT: Do not build the entire restaurant management system yet. This is Phase 1 only. Create a strong, production-quality foundation that we can extend in later phases without rebuilding the project.

BRAND

Restaurant name: Flamio

Current address: Kishoreganj Sadar, Gurudayal College, Bangladesh

Phone number: Not provided yet. Facebook page: Not provided yet. Instagram: Not provided yet. Google Maps location: Not provided yet.

Do NOT invent missing business information.

PRIMARY GOAL

Create a premium, modern, mobile-first restaurant ordering website for Flamio.

The website must feel like a real premium food brand, not a generic template.

It must work beautifully on:

Mobile

Tablet

Desktop

iPhone

Android

Use a clean, elegant restaurant-focused design with excellent typography, spacing, food imagery, responsive layouts, subtle animations and strong call-to-action buttons.

Avoid an ordinary SaaS-looking design.

PHASE 1 FEATURES

Build these:

Home Page

Menu Page

Product Detail

Category Navigation

Cart

Basic Checkout UI

Restaurant Information

Contact/Location section

Responsive navigation

Owner-editable data architecture for products/categories

Do NOT implement real payment gateway integration yet.

Do NOT implement inventory deduction yet.

Do NOT implement staff management yet.

Do NOT implement Kitchen Display System yet.

Do NOT implement advanced reports yet.

Those will be added in later phases.

HOME PAGE

Create a premium homepage with:

Hero section

Flamio branding

Main CTA: "Order Now"

Featured Products

Popular Products

Menu Categories

Promotional banner area

Restaurant introduction

Location section

Opening hours placeholder

Contact placeholder

Footer

The promotional banner must be designed so that it can later be controlled from an Owner Dashboard.

Do not invent promotions yet.

MENU CATEGORIES

Create these initial categories:

BURGER MEAT BOX PIZZA PASTA SHAWARMA & SIDES

Categories must be data-driven, not hard-coded into the visual components.

The future Owner Dashboard must be able to:

Add category

Edit category

Delete category

Hide/show category

Reorder category

Add category image

MENU DATA

Use the following real Flamio menu data.

BURGER

Flamio Classic Burger — ৳60 Naga Fire Burger — ৳70 Crispy Chicken Burger — ৳70 Cheesy Blast Burger — ৳90 Flamio Special Burger — ৳99 Crispy Cheese Crunch — ৳110 BBQ Cheese Burst Burger — ৳120

MEAT BOX

Mini Meat Box — ৳99 Mini Naga Meat Box — ৳120 BBQ Meat Box — ৳120 Regular Meat Box — ৳150 Flamio Special Meat Box — ৳199 Full Chicken Meat Box — ৳250

PIZZA

Italian Margherita Classica — ৳200 Savory Sausage — ৳250 BBQ Chicken Supreme — ৳280 Meat Lovers Deluxe — ৳300 Pepperoni Blast — ৳330 Italiano Flamio Special — ৳400

PASTA

Oven Baked Pasta — ৳150

SHAWARMA & SIDES

Chicken Shawarma — ৳99 Nachos — ৳110 BBQ Wings (4 Pcs) — ৳140 Chicken Lollipop (6 Pcs) — ৳140

PRODUCT CARD

Each product card should include:

Product image area

Product name

Price

Add button

Product details interaction

Optional badges such as Popular/New

Use attractive placeholder food images where actual images are not yet available.

Make it easy to replace images later.

PRODUCT DETAIL

When a customer clicks a product, open a premium product detail page or modal.

Show:

Large product image

Product name

Description placeholder

Price

Quantity selector

Add to Cart

PIZZA VARIANT RULE

IMPORTANT:

Pizza size must NOT be mandatory.

A Pizza can have:

Single price

Italian Margherita Classica ৳200

OR

Multiple variants

6 inch 8 inch 10 inch

Each variant can have its own price.

The data model must support both cases.

The Owner must later be able to:

Add variant

Remove variant

Rename variant

Change price

Enable/disable variant

Do not force every Pizza to have a size.

For now, keep the provided Pizza prices as the default base prices.

CART

Create a real working cart.

Customers must be able to:

Add products

Remove products

Increase quantity

Decrease quantity

See subtotal

See total

Cart should persist while navigating between menu/product pages.

Create a polished mobile cart experience.

CHECKOUT UI

Create a checkout interface with:

Customer name Phone number Delivery address Order notes Delivery/Pickup selection Payment method placeholder

Payment methods can initially be:

Cash on Delivery Online Payment — Coming Soon

Do not connect real payment APIs yet.

Create the UI and data structure so real payment methods can be added later.

RESTAURANT INFORMATION

Show:

Flamio

Kishoreganj Sadar, Gurudayal College

Keep phone, Facebook, Instagram and Google Maps fields editable later.

Do not invent values.

OWNER-EDITABLE ARCHITECTURE

Even though the Owner Dashboard is not being fully built in Phase 1, structure the data so future Dashboard functionality can manage:

Categories

Products

Product prices

Product images

Product availability

Pizza variants

Restaurant information

Homepage banners

Do NOT hard-code these values into components.

DATABASE / BACKEND

Use a clean data model that can later support:

restaurants categories products product_variants product_images addons orders order_items customers addresses staff roles permissions inventory recipes suppliers purchases payments delivery_zones offers coupons notifications audit_logs

Do not implement every table or feature yet if it is unnecessary for Phase 1.

Focus on a clean foundation.

CODE QUALITY

Use reusable components.

Do not duplicate components unnecessarily.

Keep product/category data separate from UI.

Use clear naming.

Make the application easy to extend.

Do not create fake backend functionality that only looks functional.

If a feature is not implemented yet, clearly keep it as a future-ready placeholder.

ERROR / LOADING STATES

Create:

Loading states

Empty states

Error states

Success feedback

Do not expose technical errors to customers.

ACCESSIBILITY

Use:

Proper button labels

Keyboard-friendly interactions

Good contrast

Readable text

Touch-friendly controls

Semantic HTML where appropriate

PERFORMANCE

Optimize for mobile.

Avoid unnecessarily large assets.

Use responsive images.

Keep animations subtle.

Do not sacrifice performance for visual effects.

IMPORTANT DEVELOPMENT RULE

Do not build a static mockup.

The Menu and Cart must actually work.

The product data must be structured so that it can later be managed from the Owner Dashboard.

Do not invent missing business information.

Do not add fake reviews, fake phone numbers, fake social links or fake restaurant statistics.

At the end of this phase, make sure the application runs correctly and the customer can:

Home → Menu → Product → Add to Cart → Cart → Checkout

Do not move to Phase 2 until Phase 1 is working correctly.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/f34744b1-6c89-4450-a343-ac8b9c176577).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

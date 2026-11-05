# Golden questions for the persistent offline pilot

`persistent-golden.sql` executes these checks as `demo_reader`. The verifier calculates expected values separately from the pinned fixture and checks every result. All results describe the synthetic pilot; money is EUR minor units. The database is isolated and this suite is not a CDC, Kafka or live-cutover certification.

| Key | Question and grain |
| --- | --- |
| `sessions` | How many synthetic observed sessions? Session grain. |
| `events` | How many browser events? Event grain. |
| `product_views` | How many product-view events? Event grain, not distinct products. |
| `searches` | How many search-query events? Event grain, no search-to-cart claim. |
| `carts` | How many distinct cart IDs have a synthetic cart change? Cart grain. |
| `orders` | How many synthetic order headers? Order grain, no payment implication. |
| `order_lines` | How many synthetic order lines? Line grain. |
| `line_total_eur_minor` | What is the sum of synthetic line snapshots in EUR? Line grain. |
| `captured_eur_minor` | How much synthetic payment was captured in EUR? Payment-action grain. |
| `refunded_eur_minor` | How much synthetic payment was refunded in EUR? Payment-action grain. |
| `deleted_cart_lines` | How many synthetic cart delete revisions? Change grain. |
| `on_orders` | How many current synthetic order states are ON? Order grain, not a terminal journey metric. |
| `category_product_views` | How many product views match a category relation valid at event time? Bridge/event grain; multicategory products may contribute multiple rows. |
| `invalid_order_price` | How many synthetic lines fail to match the currency, rule, amount and price validity at order time? Expected zero. |

The same SQL also checks SELECT and INSERT privileges, followed by a real denied DELETE attempt. Daily/source/category groups, temporal joins, replay and wider relationship checks were separately exercised by `expanded-postgres-check.mjs`.

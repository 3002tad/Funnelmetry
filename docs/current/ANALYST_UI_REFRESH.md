# Analyst UI refresh

Ports the approved Analyst prototype to the existing React application.

- Overview with selectable date windows and day/week/month A/B comparison.
- Product exploration with price context and interest counts.
- Conversion journey, Events and Data Quality screens.
- Shared prototype shell, icons, theme, visible logout and personal settings.
- Read-only datasets/explorer API and authenticated profile update.

Shared UI foundations also affect the existing Admin shell. Admin module routes
and navigation remain on their existing implementation in this branch. New Admin
workspace screens and Auto Scaling API/collector are excluded.

No database migration, seed, deployment or controller activation is included.
Exploratory values preserve dataset origin and uncertainty; missing values are
not replaced with invented observations. See the OpenAPI explorer endpoints.

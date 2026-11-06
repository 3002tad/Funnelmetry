# Native prototype UI

`source/analyst` and `source/admin` are unmodified CSS copied from the approved
HTML prototypes. `scripts/build-template-css.mjs` only namespaces selectors,
custom properties and keyframes. It records source SHA-256 hashes in
`source-manifest.json`; it does not alter dimensions or colors.

React components use the original class names with a `tpl-` prefix. TemplateShell
ports the original shell DOM. Existing authenticated API clients and capability
gates provide the data and actions. No prototype JavaScript, snapshots or demo
passwords are included in the production bundle.

`integration.css` contains only React/accessibility and unsupported-data states,
plus compatibility for secondary screens still used by detailed inspectors.
The old shell stylesheet and `preview-alignment.css` are no longer loaded.

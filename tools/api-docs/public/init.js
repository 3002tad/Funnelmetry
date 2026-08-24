/* global SwaggerUIBundle, SwaggerUIStandalonePreset */
window.onload = () => {
  window.ui = SwaggerUIBundle({
    url: "/openapi.yaml",
    dom_id: "#swagger-ui",
    deepLinking: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    persistAuthorization: true,
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "StandaloneLayout",
  });
};

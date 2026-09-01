/* global SwaggerUIBundle, SwaggerUIStandalonePreset */
window.onload = () => {
  window.ui = SwaggerUIBundle({
    urls: [
      { url: "/openapi-v2.yaml", name: "Funnelmetry Analytics V2" },
      { url: "/openapi.yaml", name: "Legacy V1 reference" },
    ],
    "urls.primaryName": "Funnelmetry Analytics V2",
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

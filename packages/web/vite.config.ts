import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Notia",
        short_name: "Notia",
        description: "Lo que tenés que hacer, incluso lo que no anotaste vos.",
        theme_color: "#16222B",
        background_color: "#F2F5F7",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icono.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
  // La API sirve esto como estáticos: un solo origen, sin CORS.
  build: { outDir: "../api/public", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/login": "http://localhost:3000",
    },
  },
});

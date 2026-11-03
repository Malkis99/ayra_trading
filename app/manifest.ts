import type { MetadataRoute } from "next";

/** The app's install card (PWA): the brand kit's icons on the dark background. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AYRA Trading",
    short_name: "AYRA",
    description: "AYRA Trading — Trade · Train · Evolve.",
    start_url: "/",
    display: "standalone",
    background_color: "#121117",
    theme_color: "#121117",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android shapes: the kit's maskable icons keep the sign inside the safe zone
      { src: "/brand/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

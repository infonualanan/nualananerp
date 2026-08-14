import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "NUALANAN ERP 2.0",
    short_name: "NUALANAN ERP",
    description: "ระบบบริหารโรงงานและบัญชีนวลอนันต์",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7f5",
    theme_color: "#0f3d2e",
    lang: "th",
  };
}

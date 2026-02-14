import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "ChromeRec",
  description: "Record any Chrome tab with one click",
  version: "0.1.0",
  permissions: ["tabCapture", "offscreen", "storage", "activeTab"],
  action: {
    default_popup: "src/popup/index.html",
    default_title: "ChromeRec",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
});

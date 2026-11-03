import process from "node:process";
import type { AppMeta } from "@calcom/types/App";

export const metadata = {
  name: "RothBlueprint Video",
  description:
    "RothBlueprint Video is the web-based video conferencing platform powered by Daily.co, which is minimalistic and lightweight, but has most of the features you need.",
  installed: !!process.env.DAILY_API_KEY,
  type: "daily_video",
  variant: "conferencing",
  url: "https://daily.co",
  categories: ["conferencing"],
  logo: "icon.svg",
  publisher: "RothBlueprint",
  category: "conferencing",
  slug: "daily-video",
  title: "RothBlueprint Video",
  isGlobal: true,
  email: "help@cal.com",
  appData: {
    location: {
      linkType: "dynamic",
      type: "integrations:daily",
      label: "RothBlueprint Video",
    },
  },
  key: { apikey: process.env.DAILY_API_KEY },
  dirName: "dailyvideo",
  isOAuth: false,
} as AppMeta;

export default metadata;

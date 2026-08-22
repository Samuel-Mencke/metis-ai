import { config } from "@/lib/config";
import type { GlobalModelSettings } from "@/lib/store";

function envFlag(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

export type FeatureFlags = {
  plans: boolean;
  notes: boolean;
  recovery: boolean;
  askUserTimeout: boolean;
  voiceInput: boolean;
  browser: boolean;
};

export function featureFlags(settings?: GlobalModelSettings): FeatureFlags {
  return {
    plans: settings?.featureFlags?.plans ?? envFlag("FEATURE_PLANS", true),
    notes: settings?.featureFlags?.notes ?? envFlag("FEATURE_NOTES", true),
    recovery: settings?.featureFlags?.recovery ?? envFlag("FEATURE_RECOVERY", true),
    askUserTimeout: settings?.featureFlags?.askUserTimeout ?? envFlag("FEATURE_ASK_USER_TIMEOUT", true),
    voiceInput: settings?.featureFlags?.voiceInput ?? envFlag("FEATURE_VOICE_INPUT", true),
    browser: settings?.featureFlags?.browser ?? envFlag("FEATURE_BROWSER", true),
  };
}

export function publicFeatureFlags(settings?: GlobalModelSettings) {
  return {
    ...featureFlags(settings),
    appName: config.appName,
  };
}


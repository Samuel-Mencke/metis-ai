export function isVoiceOnlyProviderConnection(connection: {
  slug?: string;
  label?: string;
  config?: Record<string, unknown>;
}) {
  if (connection.config?.purpose === "voice") return true;
  const slug = (connection.slug || "").trim().toLowerCase();
  return slug.startsWith("voice-");
}

export const PROJECT_COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f97316", "#14b8a6", "#22c55e", "#0ea5e9", "#eab308"];
export const PROJECT_ICONS = ["folder", "briefcase", "code", "sparkles", "book", "flask", "rocket", "palette"] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

export const PROJECT_LOGO_MIMES = new Set([
 "image/png",
 "image/jpeg",
 "image/jpg",
 "image/webp",
 "image/gif",
 "image/svg+xml",
]);

export const MAX_PROJECT_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_FILE_BYTES = 20 * 1024 * 1024;

export function isProjectLogoMime(mime: string): boolean {
 return PROJECT_LOGO_MIMES.has(mime.toLowerCase().split(";")[0]!.trim());
}

export function projectLogoSrc(projectId: string, updatedAt?: string) {
 const query = updatedAt ? `?t=${encodeURIComponent(updatedAt)}` : "";
 return `/api/projects/${encodeURIComponent(projectId)}/logo${query}`;
}

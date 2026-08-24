"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type UpdateData = {
 updateAvailable?: boolean;
 latestTag?: string;
 release?: { name?: string; body?: string; html_url?: string };
};

export function UpdateBanner() {
 const [data, setData] = useState<UpdateData | null>(null);
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState("");

 useEffect(() => {
 let active = true;
 void fetch("/api/admin/system/update", { cache: "no-store" })
 .then(async (response) => {
 if (response.status === 403 || response.status === 401) return;
 const next = (await response.json().catch(() => ({}))) as UpdateData;
 if (active && response.ok) setData(next);
 })
 .catch(() => undefined);
 return () => { active = false; };
 }, []);

 if (!data?.updateAvailable) return null;
 const release = data.release;

 async function prepareUpdate() {
 setBusy(true);
 setMessage("");
 try {
 const response = await fetch("/api/admin/system/update", { method: "POST" });
 const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
 if (!response.ok) throw new Error(result.error || "Update failed.");
 setMessage(result.message || "Update prepared. Restart is required to activate it.");
 } catch (error) {
 setMessage(error instanceof Error ? error.message : "Update failed.");
 } finally {
 setBusy(false);
 }
 }

 return (
 <section className="flex items-start gap-3 border-b border-primary/20 bg-primary/5 px-4 py-3 text-sm" role="status">
 <RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />
 <div className="min-w-0 flex-1">
 <p className="font-medium">New updates available{data.latestTag ? ` (${data.latestTag})` : ""}</p>
 {release?.name ? <p className="text-muted-foreground">{release.name}</p> : null}
 {release?.body ? <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{release.body}</p> : null}
 {message ? <p className="mt-1 text-xs text-muted-foreground">{message}</p> : null}
 </div>
 <Button type="button" size="sm" onClick={() => void prepareUpdate()} disabled={busy}>
 {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Prepare update"}
 </Button>
 </section>
 );
}

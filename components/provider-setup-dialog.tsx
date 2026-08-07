"use client";

import { useEffect, useState } from "react";
import { Check, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ProviderDefinition = {
  key: string;
  name: string;
  description: string;
  authTypes: string[];
  defaultBaseUrl?: string;
};

type OAuthFlow = {
  id: string;
  status: string;
  authUrl?: string;
  instructions?: string;
  userCode?: string;
  error?: string;
  manualInputRequired?: boolean;
};

const API_KEY_URLS: Record<string, string> = {
  cursor: "https://cursor.com/dashboard/api",
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
  google: "https://aistudio.google.com/app/apikey",
  xai: "https://console.x.ai/",
  openrouter: "https://openrouter.ai/keys",
  codex: "https://platform.openai.com/api-keys",
  "claude-code": "https://console.anthropic.com/settings/keys",
  antigravity: "https://aistudio.google.com/app/apikey",
};

export function ProviderSetupDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [oauthFlow, setOauthFlow] = useState<OAuthFlow | null>(null);

  const selected = providers.find((provider) => provider.key === selectedKey);
  const supportsOAuth = selected?.authTypes.includes("oauth") ?? false;
  const apiKeyUrl = selected ? API_KEY_URLS[selected.key] : undefined;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    void fetch("/api/providers", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          providers?: ProviderDefinition[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "Could not load providers.");
        const nextProviders = data.providers || [];
        setProviders(nextProviders);
        setSelectedKey((current) => current || nextProviders[0]?.key || "");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load providers."))
      .finally(() => setLoading(false));
  }, [open]);

  function selectProvider(providerKey: string) {
    setSelectedKey(providerKey);
    setSecret("");
    setOauthFlow(null);
    setError("");
  }

  async function connectApiKey() {
    if (!selected || !secret.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerKey: selected.key,
          slug: `${selected.key}-main`,
          label: selected.name,
          authType: "api_key",
          ...(selected.defaultBaseUrl ? { baseUrl: selected.defaultBaseUrl } : {}),
          secret: secret.trim(),
          enabled: true,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save provider.");
      toast.success(`${selected.name} connected`);
      setSecret("");
      onConnected();
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save provider.");
    } finally {
      setBusy(false);
    }
  }

  async function connectOAuth() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    setOauthFlow(null);
    let openedAuthUrl = false;
    try {
      const response = await fetch("/api/providers/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerKey: selected.key,
          slug: `${selected.key}-oauth`,
          label: `${selected.name} OAuth`,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        flow?: OAuthFlow;
        error?: string;
      };
      if (!response.ok || !data.flow) throw new Error(data.error || "Could not start OAuth.");
      setOauthFlow(data.flow);

      for (let attempt = 0; attempt < 600; attempt += 1) {
        const statusResponse = await fetch(
          `/api/providers/oauth/status?flowId=${encodeURIComponent(data.flow.id)}`,
          { cache: "no-store" },
        );
        const statusData = (await statusResponse.json().catch(() => ({}))) as {
          flow?: OAuthFlow;
          error?: string;
        };
        if (!statusResponse.ok || !statusData.flow) {
          throw new Error(statusData.error || "Could not read OAuth status.");
        }
        setOauthFlow(statusData.flow);
        if (statusData.flow.authUrl && !openedAuthUrl) {
          openedAuthUrl = true;
          const popup = window.open(statusData.flow.authUrl, "_blank", "noopener,noreferrer");
          if (!popup) toast.info("Open the authorization link shown in the dialog.");
        }
        if (["completed", "error", "cancelled"].includes(statusData.flow.status)) {
          if (statusData.flow.status !== "completed") {
            throw new Error(statusData.flow.error || "OAuth was not completed.");
          }
          toast.success(`${selected.name} connected`);
          onConnected();
          onOpenChange(false);
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      throw new Error("OAuth login timed out.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "OAuth login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add your provider</DialogTitle>
          <DialogDescription>
            Choose the provider you prefer, then connect it to start chatting.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" /> Loading providers…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {providers.map((provider) => (
                <button
                  key={provider.key}
                  type="button"
                  onClick={() => selectProvider(provider.key)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                    provider.key === selectedKey
                      ? "border-primary bg-primary/10"
                      : "border-border/60 hover:bg-muted/50"
                  }`}
                >
                  <ProviderLogo providerId={provider.key} className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{provider.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{provider.description}</span>
                  </span>
                  {provider.key === selectedKey ? <Check className="size-4 text-primary" /> : null}
                </button>
              ))}
            </div>
            {selected ? (
              <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-4" /> Connect {selected.name}
                </p>
                <Input
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="Paste your API key"
                  autoComplete="off"
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void connectApiKey();
                  }}
                />
                {apiKeyUrl ? (
                  <a
                    className="inline-block text-sm text-primary underline underline-offset-4 hover:text-primary/80"
                    href={apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get an API key
                  </a>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  {supportsOAuth ? (
                    <Button type="button" variant="outline" onClick={() => void connectOAuth()} disabled={busy}>
                      <ShieldCheck className="size-4" /> Use OAuth
                    </Button>
                  ) : null}
                  <Button type="button" onClick={() => void connectApiKey()} disabled={busy || !secret.trim()}>
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                    Connect API key
                  </Button>
                </div>
                {oauthFlow ? (
                  <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                    <p>{oauthFlow.instructions || "Complete the authorization in the opened window."}</p>
                    {oauthFlow.authUrl ? <a className="break-all underline" href={oauthFlow.authUrl} target="_blank" rel="noreferrer">{oauthFlow.authUrl}</a> : null}
                    {oauthFlow.userCode ? <p className="font-mono">Code: {oauthFlow.userCode}</p> : null}
                    <p className="text-muted-foreground">Status: {oauthFlow.status}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

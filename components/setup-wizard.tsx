"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProviderSetupDialog } from "@/components/provider-setup-dialog";

type OsPlatform = "linux" | "darwin" | "win32";
type OsUser = { username: string; home?: string };

function platformLabel(platform: OsPlatform) {
  return platform === "win32" ? "Windows user" : platform === "darwin" ? "Mac user" : "Linux user";
}

export function SetupWizard({
  open,
  hasUsers,
  onFinished,
}: {
  open: boolean;
  hasUsers: boolean;
  onFinished: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(hasUsers ? 2 : 1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [platform, setPlatform] = useState<OsPlatform>("linux");
  const [osUsers, setOsUsers] = useState<OsUser[]>([]);
  const [osUsername, setOsUsername] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep(hasUsers ? 2 : 1);
  }, [open, hasUsers]);

  useEffect(() => {
    if (!open || step !== 2) return;
    void fetch("/api/setup", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          platform?: OsPlatform;
          osUsers?: OsUser[];
        };
        setPlatform(body.platform || "linux");
        setOsUsers(body.osUsers || []);
      })
      .catch(() => undefined);
  }, [open, step]);

  const steps = useMemo(
    () => [
      { id: 1, label: "Account" },
      { id: 2, label: platformLabel(platform) },
      { id: 3, label: "Provider" },
    ],
    [platform],
  );

  if (!open) return null;

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bootstrap", username, password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create account.");
      setStep(2);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }

  async function bindOsUser(skip = false) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "os-user", osUsername: skip ? null : osUsername || null }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not bind host user.");
      setStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not bind host user.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete" }),
    }).catch(() => undefined);
    onFinished();
  }

  return (
    <div className="fixed inset-0 z-[80] flex min-h-dvh flex-col bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-12">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Metis setup</p>
          <h1 className="text-3xl font-semibold tracking-tight">Set up this instance</h1>
          <p className="text-sm text-muted-foreground">This only runs once. The app stays locked until an admin account exists.</p>
        </div>
        <ol className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Setup progress">
          {steps.map((item) => (
            <li key={item.id} className="flex min-w-0 items-center gap-2">
              <span className={`flex size-6 items-center justify-center rounded-full text-[11px] font-medium ${
                step > item.id
                  ? "bg-primary text-primary-foreground"
                  : step === item.id
                    ? "bg-foreground text-background"
                    : "bg-muted"
              }`}>
                {step > item.id ? <Check className="size-3" /> : item.id}
              </span>
              <span className={step === item.id ? "text-foreground" : ""}>{item.label}</span>
            </li>
          ))}
        </ol>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {step === 1 ? (
          <form onSubmit={(event) => void createAccount(event)} className="grid gap-4">
            <label className="grid gap-1 text-sm">
              Admin username
              <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoFocus required minLength={3} />
            </label>
            <label className="grid gap-1 text-sm">
              Password
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            <Button type="submit" className="h-11 rounded-xl" disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <>Continue <ArrowRight className="size-4" /></>}
            </Button>
          </form>
        ) : null}
        {step === 2 ? (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              Optionally bind this admin to a {platformLabel(platform)} so tools run as that identity.
            </p>
            <label className="grid gap-1 text-sm">
              {platformLabel(platform)}
              <select
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                value={osUsername}
                onChange={(event) => setOsUsername(event.target.value)}
              >
                <option value="">None</option>
                {osUsers.map((user) => (
                  <option key={user.username} value={user.username}>
                    {user.username}{user.home ? ` · ${user.home}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="h-11 rounded-xl" disabled={busy} onClick={() => void bindOsUser(false)}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : "Continue"}
              </Button>
              <Button type="button" variant="ghost" className="h-11 rounded-xl" disabled={busy} onClick={() => void bindOsUser(true)}>
                Skip for now
              </Button>
            </div>
          </div>
        ) : null}
        {step === 3 ? (
          <ProviderSetupDialog
            open
            embedded
            onOpenChange={() => undefined}
            onConnected={() => void finish()}
            onStartChat={() => void finish()}
          />
        ) : null}
      </div>
    </div>
  );
}

import { Suspense } from "react";
import AppShell from "@/components/app-shell";
import { config } from "@/lib/config";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
          …
        </main>
      }
    >
      <AppShell defaultCwd={config.agentCwd} />
    </Suspense>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type BrowserSettingsValues = {
  browserEnabled: boolean;
  browserRealtime: boolean;
  browserFps: number;
  browserViewportWidth: number;
  browserViewportHeight: number;
};

export function BrowserSettingsControls({
  browserEnabled,
  browserRealtime,
  browserFps,
  browserViewportWidth,
  browserViewportHeight,
  onChange,
  compact = false,
}: BrowserSettingsValues & {
  onChange: (next: Partial<BrowserSettingsValues>) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "grid gap-3" : "mt-3 grid gap-3"}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Browser workspace</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            When off, agents cannot use browser tools and the sidebar tab is removed.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={browserEnabled ? "default" : "outline"}
          aria-pressed={browserEnabled}
          onClick={() => onChange({ browserEnabled: !browserEnabled })}
          className="shrink-0"
        >
          {browserEnabled ? "On" : "Off"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">Realtime updates</p>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            When off, the preview updates only after browser actions.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={browserRealtime ? "default" : "outline"}
          aria-pressed={browserRealtime}
          onClick={() => onChange({ browserRealtime: !browserRealtime })}
          className="shrink-0"
        >
          {browserRealtime ? "On" : "Action only"}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          FPS
          <Input
            type="number"
            min={1}
            max={30}
            aria-label="Browser stream FPS"
            value={browserFps}
            onChange={(event) => onChange({
              browserFps: Math.max(1, Math.min(30, Math.round(Number(event.target.value) || 5))),
            })}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Width
          <Input
            type="number"
            min={320}
            max={2560}
            value={browserViewportWidth}
            onChange={(event) => onChange({
              browserViewportWidth: Math.max(320, Math.min(2560, Number(event.target.value) || 1280)),
            })}
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Height
          <Input
            type="number"
            min={240}
            max={1600}
            value={browserViewportHeight}
            onChange={(event) => onChange({
              browserViewportHeight: Math.max(240, Math.min(1600, Number(event.target.value) || 800)),
            })}
          />
        </label>
      </div>
    </div>
  );
}

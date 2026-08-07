"use client";

import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { JailbreakPromptPicker } from "@/components/jailbreak-prompt-picker";
import { cn } from "@/lib/utils";
import { UNCENSORED_PARAMETER } from "@/lib/model-params";
import type {
  ModelInfo,
  ModelParamSelection,
  ModelParameter,
} from "@/components/settings-panel";

function labelFor(param: ModelParameter, value: string) {
  const match = param.values.find((v) => v.value === value);
  if (match?.displayName) return match.displayName;
  if (value === "true") return "On";
  if (value === "false") return "Off";
  return value;
}

type Props = {
  model: ModelInfo;
  modelParams: ModelParamSelection[];
  onModelParamsChange: (params: ModelParamSelection[]) => void;
  onInsertPrompt?: (text: string) => void;
  className?: string;
};

export function ModelOptionsMenu({
  model,
  modelParams,
  onModelParamsChange,
  onInsertPrompt,
  className,
}: Props) {
  const parameters = [
    ...(model.parameters ?? []),
    ...((model.parameters ?? []).some((parameter) => parameter.id === "uncensored")
      ? []
      : [UNCENSORED_PARAMETER]),
  ];

  function paramValue(id: string): string {
    return modelParams.find((p) => p.id === id)?.value ?? "";
  }

  function setParam(id: string, value: string) {
    const allowed = new Set(parameters.map((p) => p.id));
    const next = [
      ...modelParams.filter((p) => p.id !== id && allowed.has(p.id)),
      { id, value },
    ].filter((p) => allowed.has(p.id));
    onModelParamsChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Model options"
          className={cn(
            "size-7 rounded-full text-muted-foreground opacity-100",
            className,
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-72 space-y-4 p-4"
      >
        <div>
          <p className="text-sm font-medium">{model.displayName}</p>
          <p className="text-xs text-muted-foreground">
            Thinking, effort, fast, and other options
          </p>
        </div>

        <div className="space-y-4">
          {parameters.map((param) => {
            const current = paramValue(param.id);
            const isBool =
              param.values.length === 2 &&
              param.values.some((v) => v.value === "true") &&
              param.values.some((v) => v.value === "false");

            if (isBool) {
              const on = current === "true";
              const isUncensored = param.id === "uncensored";
              return (
                <div
                  key={param.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-1">
                    <p className="text-sm">{param.displayName || param.id}</p>
                    {isUncensored && onInsertPrompt ? (
                      <JailbreakPromptPicker
                        modelDisplayName={model.displayName}
                        onPick={onInsertPrompt}
                      />
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="min-w-14 rounded-full"
                    onClick={() => setParam(param.id, on ? "false" : "true")}
                  >
                    {on ? "On" : "Off"}
                  </Button>
                </div>
              );
            }

            return (
              <div key={param.id} className="space-y-2">
                <p className="text-sm">{param.displayName || param.id}</p>
                <div className="flex flex-wrap gap-1.5">
                  {param.values.map((v) => {
                    const active = current === v.value;
                    return (
                      <Button
                        key={v.value}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        className="h-7 rounded-full px-2.5 text-xs"
                        onClick={() => setParam(param.id, v.value)}
                      >
                        {labelFor(param, v.value)}
                      </Button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {model.defaultParams && model.defaultParams.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-0 text-xs text-muted-foreground"
            onClick={() => onModelParamsChange(model.defaultParams || [])}
          >
            Reset defaults
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

"use client";

import { Check, ChevronDown } from "lucide-react";
import { ProjectAvatar } from "@/components/project-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export type NoteProjectOption = {
  id: string;
  name: string;
  icon: string;
  color: string;
  logoStoredName?: string;
  updatedAt?: string;
};

export function NoteProjectMenu({
  projectId,
  projects,
  onChange,
}: {
  projectId?: string | null;
  projects: NoteProjectOption[];
  onChange: (projectId: string | null) => void;
}) {
  const selected = projectId ? projects.find((project) => project.id === projectId) : undefined;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-28 shrink-0 items-center gap-0.5 rounded bg-black/10 px-1 py-0.5 text-left text-[9px] font-medium tracking-wide text-black/70 outline-none hover:bg-black/15"
          aria-label="Assign note to project"
          title={selected?.name || "No project"}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {selected ? (
            <>
              <ProjectAvatar
                id={selected.id}
                icon={selected.icon}
                color={selected.color}
                hasLogo={Boolean(selected.logoStoredName)}
                updatedAt={selected.updatedAt}
                className="size-3 rounded-sm"
              />
              <span className="min-w-0 truncate">{selected.name}</span>
            </>
          ) : (
            <span className="truncate">No project</span>
          )}
          <ChevronDown className="size-2.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        onPointerDown={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem className="text-xs" onSelect={() => onChange(null)}>
          <span className="min-w-0 flex-1 truncate">No project</span>
          {!selected ? <Check className="size-3.5 opacity-70" /> : null}
        </DropdownMenuItem>
        {projects.length ? <DropdownMenuSeparator /> : null}
        {projects.map((project) => {
          const active = selected?.id === project.id;
          return (
            <DropdownMenuItem
              key={project.id}
              className="text-xs"
              onSelect={() => onChange(project.id)}
            >
              <ProjectAvatar
                id={project.id}
                icon={project.icon}
                color={project.color}
                hasLogo={Boolean(project.logoStoredName)}
                updatedAt={project.updatedAt}
                className="size-4 rounded-md"
              />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {active ? <Check className="size-3.5 opacity-70" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

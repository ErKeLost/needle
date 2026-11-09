import { Button, Dropdown, Label } from "@heroui/react";
import type { MusicSource } from "../music/types";
import { SourceLogo } from "./SourceLogo";

type Props = {
  sources: MusicSource[];
  activeId: string;
  onPick: (source: MusicSource) => void;
  onOpenFiles: () => void;
  onSearch: () => void;
};

export function SourceMenu({ sources, activeId, onPick, onOpenFiles, onSearch }: Props) {
  const active = sources.find((source) => source.id === activeId) ?? sources[0];

  return (
    <Dropdown>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 gap-2.5 px-2 text-[12.5px] font-normal text-[var(--paper-72)]"
        aria-label="Source"
      >
        <SourceLogo id={active.id} size={26} />
        {active.name}
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </Button>

      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            const id = String(key);
            if (id === "search") {
              onSearch();
              return;
            }
            if (id === "files") {
              onOpenFiles();
              return;
            }
            const next = sources.find((source) => source.id === id);
            if (next) onPick(next);
          }}
        >
          {sources.map((source) => (
            <Dropdown.Item key={source.id} id={source.id} textValue={source.name}>
              <span className="source__name">
                <SourceLogo id={source.id} size={22} />
                <Label>{source.name}</Label>
              </span>
            </Dropdown.Item>
          ))}
          <Dropdown.Item id="search" textValue="Search">
            <Label>Search…</Label>
          </Dropdown.Item>
          <Dropdown.Item id="files" textValue="Open files">
            <Label>Open files…</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

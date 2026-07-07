"use client";

import { useEffect, useState } from "react";
import { useData } from "@/lib/store";

export function TimerWidget() {
  const { runningTimer, tasks, projects, clients, stopTimer, completeTimerEntry, openTask } = useData();
  const [, tick] = useState(0);
  const [pendingStop, setPendingStop] = useState<{
    entryId: string;
    taskId: string;
    minutes: number;
  } | null>(null);
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!runningTimer) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [runningTimer]);

  if (pendingStop) {
    const task = tasks.find((t) => t.id === pendingStop.taskId);
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!description.trim()) return;
          completeTimerEntry(
            pendingStop.entryId,
            pendingStop.taskId,
            pendingStop.minutes,
            description.trim(),
          );
          setPendingStop(null);
          setDescription("");
        }}
      >
        <span className="text-xs text-muted hidden md:inline">
          {task?.title} — {pendingStop.minutes}m
        </span>
        <input
          autoFocus
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What did you do? (required)"
          className="bidi-auto h-8 w-56 rounded-md border border-border-strong bg-surface px-2 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-dark"
        >
          Save
        </button>
      </form>
    );
  }

  if (!runningTimer) return null;

  const task = tasks.find((t) => t.id === runningTimer.taskId);
  const project = projects.find((p) => p.id === task?.projectId);
  const client = clients.find((c) => c.id === project?.clientId);
  const elapsed = Math.floor((Date.now() - runningTimer.startedAt) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-3 rounded-full border border-border bg-surface pl-3 pr-1.5 py-1">
      <span className="relative flex size-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-danger" />
      </span>
      <button
        className="text-sm font-medium hover:text-brand max-w-44 truncate"
        onClick={() => task && openTask(task.id)}
        style={{ color: client?.color }}
      >
        {task?.title ?? "…"}
      </button>
      <span className="font-mono text-sm tabular-nums">{mm}:{ss}</span>
      <button
        onClick={() => {
          const result = stopTimer();
          if (result) setPendingStop(result);
        }}
        className="h-7 rounded-full bg-foreground px-3 text-xs font-medium text-white hover:bg-black"
      >
        Stop
      </button>
    </div>
  );
}

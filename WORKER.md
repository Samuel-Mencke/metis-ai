# Durable agent worker

The web service accepts durable jobs at `POST /api/runs`; jobs and checkpoints
are stored below `CHAT_DATA_DIR` (default: `data/`). The worker processes up to
four jobs in parallel by default (`AI_CHAT_WORKER_CONCURRENCY`) and recovers
stale `running` jobs after a process restart.

The worker requires `CURSOR_API_KEY`, the same `CHAT_DATA_DIR`, and the agent
workspace settings used by the web service. Run it manually with:

```sh
node node_modules/tsx/dist/cli.mjs worker.ts
```

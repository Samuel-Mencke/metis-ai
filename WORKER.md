# Durable agent worker

The web service accepts durable jobs at `POST /api/runs`; jobs and checkpoints
are stored below `CHAT_DATA_DIR` (default: `data/`). The worker processes up to
25 jobs in parallel by default (`AI_CHAT_WORKER_CONCURRENCY`) and recovers
stale `running` jobs after a process restart.

The worker uses the per-user Cursor SDK connections configured in Settings,
the same `CHAT_DATA_DIR`, and the agent workspace settings used by the web
service. Run it manually with:

```sh
node node_modules/tsx/dist/cli.mjs worker.ts
```

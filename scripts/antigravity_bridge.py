#!/usr/bin/env python3
"""Small JSONL bridge for the supported Google Antigravity Python SDK path.

This intentionally does not read Antigravity CLI keyring files or call private
Google endpoints. Credentials are supplied by the parent process through the
environment and the public SDK owns the request lifecycle.

Metis tools are injected on the official `agy` OAuth path via mcp_config.json.
This Python SDK fallback only streams chat tokens.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


async def run(payload: dict[str, Any]) -> None:
    try:
        from google.antigravity import Agent, LocalAgentConfig
    except Exception as exc:  # pragma: no cover - depends on optional runtime
        emit(
            {
                "type": "error",
                "message": (
                    "Google Antigravity SDK is not installed. "
                    "Install google-antigravity in the configured Python environment."
                ),
                "detail": str(exc),
            }
        )
        raise

    prompt = str(payload.get("prompt") or "Continue the current task.")
    model = str(payload.get("model") or "").strip()
    if model:
        prompt = f"Use the configured Antigravity model {model} when available.\n\n{prompt}"

    kwargs: dict[str, Any] = {}
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        kwargs["api_key"] = api_key

    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if use_vertex:
        kwargs["vertex"] = True
        if os.environ.get("GOOGLE_CLOUD_PROJECT"):
            kwargs["project"] = os.environ["GOOGLE_CLOUD_PROJECT"]
        if os.environ.get("GOOGLE_CLOUD_LOCATION"):
            kwargs["location"] = os.environ["GOOGLE_CLOUD_LOCATION"]

    config = LocalAgentConfig(**kwargs)
    async with Agent(config) as agent:
        response = await agent.chat(prompt)
        async for token in response:
            if token:
                emit({"type": "text", "text": str(token)})
    emit({"type": "done"})


async def main() -> int:
    line = sys.stdin.readline()
    if not line:
        emit({"type": "error", "message": "No Antigravity request was provided."})
        return 1
    try:
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError("Request must be a JSON object.")
        await run(payload)
        return 0
    except Exception as exc:
        if not isinstance(exc, (KeyboardInterrupt, SystemExit)):
            emit({"type": "error", "message": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

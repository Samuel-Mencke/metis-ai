import json
import os
import subprocess
import time
import traceback
from pathlib import Path

BASE = Path.home() / ".samuel-mcp-runner"
JOBS = BASE / "jobs"
RESULTS = BASE / "results"
LOG = BASE / "runner.log"
STATUS = BASE / "status.json"
MAX_OUTPUT = 2_000_000

for directory in (BASE, JOBS, RESULTS):
    directory.mkdir(parents=True, exist_ok=True)


def log(message):
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{stamp} {message}\n")


def trim(value):
    if value is None:
        return ""
    value = str(value)
    if len(value) <= MAX_OUTPUT:
        return value
    return value[:MAX_OUTPUT] + "\n...[truncated]"


def write_json(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def run_job(job):
    action = str(job.get("action", "run"))
    timeout = max(1, min(int(job.get("timeout", 600)), 3600))
    cwd = job.get("cwd") or str(Path.home())
    env = os.environ.copy()
    env["WINAPP_CLI_TELEMETRY_OPTOUT"] = "1"
    node_path = r"C:\Program Files\nodejs"
    winapps = str(Path.home() / "AppData" / "Local" / "Microsoft" / "WindowsApps")
    env["PATH"] = node_path + os.pathsep + winapps + os.pathsep + env.get("PATH", "")
    for key, value in (job.get("env") or {}).items():
        env[str(key)] = str(value)

    started = time.time()
    if action == "spawn":
        command = job["command"]
        shell = isinstance(command, str)
        proc = subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            shell=shell,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
        )
        return {
            "ok": True,
            "action": action,
            "pid": proc.pid,
            "duration_ms": int((time.time() - started) * 1000),
        }

    if action == "kill":
        completed = subprocess.run(
            ["taskkill", "/PID", str(int(job["pid"])), "/T", "/F"],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    else:
        command = job["command"]
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            shell=isinstance(command, str),
            capture_output=True,
            text=True,
            timeout=timeout,
            errors="replace",
        )

    return {
        "ok": completed.returncode == 0,
        "action": action,
        "exit_code": completed.returncode,
        "stdout": trim(completed.stdout),
        "stderr": trim(completed.stderr),
        "duration_ms": int((time.time() - started) * 1000),
    }


def main():
    log(f"runner started pid={os.getpid()}")
    while True:
        write_json(
            STATUS,
            {
                "ok": True,
                "pid": os.getpid(),
                "session": os.environ.get("SESSIONNAME"),
                "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            },
        )
        for path in sorted(JOBS.glob("*.json"), key=lambda p: p.stat().st_mtime):
            job_id = path.stem
            working = path.with_suffix(".working")
            try:
                path.replace(working)
            except FileNotFoundError:
                continue
            try:
                job = json.loads(working.read_text(encoding="utf-8"))
                log(f"job {job_id} action={job.get('action', 'run')}")
                result = run_job(job)
            except subprocess.TimeoutExpired as exc:
                result = {
                    "ok": False,
                    "error": "timeout",
                    "stdout": trim(exc.stdout),
                    "stderr": trim(exc.stderr),
                }
            except Exception as exc:
                result = {
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            result["job_id"] = job_id
            result["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            write_json(RESULTS / f"{job_id}.json", result)
            try:
                working.unlink()
            except FileNotFoundError:
                pass
        time.sleep(0.35)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
audio-fingerprint.py — landmark audio fingerprinting for Metis AI.

Shazam-style pipeline:
  1. Decode audio to mono 11.025 kHz PCM via ffmpeg.
  2. Spectrogram peaks (local maxima in log-spaced frequency bands).
  3. Anchor + target-zone pair hashes -> (hash, t1, t2).
  4. Match against a reference SQLite DB via inverted index:
     per-reference offset-coherence histogram decides the match.

Commands:
  ingest <audio> --title T --artist A [--db PATH] [--duration N]   add reference
  match  <audio> [--db PATH] [--json]                              identify audio
  stats  [--db PATH]                                               db overview

Shared with the Metis gateway tool `audio_fingerprint`
(default DB: $AI_CHAT_ROOT/data/audio-fingerprints.sqlite or repo data/).
Uses numpy when available (fast path); pure-Python FFT otherwise.
"""
import argparse
import array
import json
import math
import os
import sqlite3
import subprocess
import sys

SR = 11025          # sample rate after downsampling
FFT = 1024          # window size (~93 ms)
HOP = 128           # hop (~11.6 ms) — balances resolution vs hash count
PEAK_BANDS = 6      # log-spaced bands for peak picking
MIN_F = 100         # ignore ultra-low bins (rumble)
MAX_F = 5000        # ignore >5 kHz
FAN_OUT = 10        # max pairs per anchor
TARGET_START = 3    # target zone starts 3 frames after anchor
TARGET_LEN = 63     # target zone spans 63 frames
MAX_DF = 63         # max frequency-bin distance within a pair
MIN_HITS = 5        # minimum coherent hashes for a match
INGEST_MAX_SECONDS = 900  # cap ingest length (15 min) to bound work

try:
    import numpy as _np
except Exception:  # pragma: no cover — pure-python fallback path
    _np = None

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DEFAULT = os.environ.get(
    "METIS_FINGERPRINT_DB",
    os.path.join(os.environ.get("AI_CHAT_ROOT", REPO), "data", "audio-fingerprints.sqlite"),
)


def die(msg, code=1):
    print(json.dumps({"ok": False, "error": msg}), file=sys.stderr)
    sys.exit(code)


def out(payload):
    print(json.dumps(payload))


# ---------------------------------------------------------------------------
# Decode
# ---------------------------------------------------------------------------

def load_audio(path):
    """Decode any audio/video file to mono float32 samples at SR."""
    cmd = ["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
           "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True)
    if raw.returncode != 0 or not raw.stdout:
        die("ffmpeg failed: " + raw.stderr.decode("utf-8", "replace")[:400])
    pcm = array.array("f")
    pcm.frombytes(raw.stdout[: len(raw.stdout) // 4 * 4])
    return pcm


# ---------------------------------------------------------------------------
# Spectrogram
# ---------------------------------------------------------------------------

def _fft_pure(re, im):
    n = len(re)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            re[i], re[j] = re[j], re[i]
            im[i], im[j] = im[j], im[i]
    length = 2
    while length <= n:
        ang = -2.0 * math.pi / length
        wRe, wIm = math.cos(ang), math.sin(ang)
        half = length >> 1
        for i in range(0, n, length):
            curRe, curIm = 1.0, 0.0
            for k in range(i, i + half):
                j2 = k + half
                tRe = re[j2] * curRe - im[j2] * curIm
                tIm = re[j2] * curRe + im[j2] * curIm
                re[j2], im[j2] = re[k] - tRe, im[k] - tIm
                re[k] += tRe
                im[k] += tIm
                curRe, curIm = curRe * wRe - curIm * wIm, curRe * wIm + curIm * wRe
        length <<= 1
    return re, im


def spectrogram(pcm, max_frames=None):
    """List of magnitude spectra (length FFT//2) per frame."""
    n = len(pcm)
    nframes = max(0, (n - FFT) // HOP + 1)
    if max_frames:
        nframes = min(nframes, max_frames)
    if _np is not None:
        sig = _np.asarray(pcm, dtype=_np.float32)
        window = _np.hanning(FFT).astype(_np.float32)
        frames = []
        for f in range(nframes):
            seg = sig[f * HOP: f * HOP + FFT]
            if len(seg) < FFT:
                seg = _np.pad(seg, (0, FFT - len(seg)))
            spec = _np.abs(_np.fft.rfft(seg * window))[1:]
            frames.append(spec.astype(_np.float32))
        return frames
    window = [0.5 * (1.0 - math.cos(2.0 * math.pi * i / (FFT - 1))) for i in range(FFT)]
    frames = []
    for f in range(nframes):
        start = f * HOP
        re = [pcm[start + i] * window[i] if start + i < n else 0.0 for i in range(FFT)]
        im = [0.0] * FFT
        re2, im2 = _fft_pure(re, im)
        frames.append([math.hypot(re2[b], im2[b]) for b in range(1, FFT // 2)])
    return frames


# ---------------------------------------------------------------------------
# Peak picking + hashing
# ---------------------------------------------------------------------------

BANDS = [max(1, int(MIN_F * (MAX_F / MIN_F) ** (b / PEAK_BANDS) * FFT / SR))
         for b in range(PEAK_BANDS + 1)]


def find_peaks(frames):
    """Strongest bin per log band per frame, with energy + density gating."""
    peaks = []
    nb = len(BANDS) - 1
    mean_energy = [1e-9] * nb
    last_seen = [-10] * nb
    for t, mag in enumerate(frames):
        for b in range(nb):
            lo, hi = BANDS[b], BANDS[b + 1]
            if hi <= lo + 1:
                continue
            if _np is not None:
                seg = mag[lo:hi]
                bi = int(_np.argmax(seg))
                amp = float(seg[bi])
            else:
                bi = 0
                amp = -1.0
                for k in range(lo, hi):
                    if mag[k] > amp:
                        amp, bi = mag[k], k - lo
            bf = lo + bi
            mean_energy[b] = 0.95 * mean_energy[b] + 0.05 * amp
            if amp < mean_energy[b] * 1.6:
                continue
            if t - last_seen[b] < 2:
                continue
            last_seen[b] = t
            peaks.append((t, bf))
    return peaks


def fingerprint(peaks):
    """Anchor + target-zone pairs -> list of (hash, t1)."""
    out = []
    n = len(peaks)
    for i, (t1, f1) in enumerate(peaks):
        count = 0
        for j in range(i + 1, n):
            t2, f2 = peaks[j]
            dt = t2 - t1
            if dt < TARGET_START:
                continue
            if dt > TARGET_START + TARGET_LEN:
                break
            df = f2 - f1
            if df < -MAX_DF or df > MAX_DF:
                continue
            h = ((f1 & 0x3FF) << 20) | ((f2 & 0x3FF) << 10) | (dt & 0x3FF)
            out.append((h, t1))
            count += 1
            if count >= FAN_OUT:
                break
    return out


def analyze(path, max_seconds=None):
    pcm = load_audio(path)
    max_frames = None
    if max_seconds:
        max_frames = int(max_seconds * SR / HOP)
    frames = spectrogram(pcm, max_frames)
    return fingerprint(find_peaks(frames))


# ---------------------------------------------------------------------------
# SQLite reference DB
# ---------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT,
  source TEXT,
  duration_sec REAL,
  hash_count INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hashes (
  hash INTEGER NOT NULL,
  t INTEGER NOT NULL,
  track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hashes_hash ON hashes(hash, track_id);
CREATE INDEX IF NOT EXISTS idx_hashes_track ON hashes(track_id);
"""


def open_db(path):
    db = sqlite3.connect(path)
    db.executescript(SCHEMA)
    return db


def cmd_ingest(args):
    if not os.path.exists(args.audio):
        die("audio file not found: " + args.audio)
    pairs = analyze(args.audio, max_seconds=INGEST_MAX_SECONDS)
    if len(pairs) < 20:
        die("too few fingerprints extracted (%d) — audio too short or silent" % len(pairs))
    db = open_db(args.db)
    try:
        db.execute("BEGIN")
        cur = db.execute(
            "INSERT INTO tracks(title, artist, source, duration_sec, hash_count) VALUES(?,?,?,?,?)",
            (args.title, args.artist, args.source, None, len(pairs)),
        )
        track_id = cur.lastrowid
        db.executemany("INSERT INTO hashes(hash, t, track_id) VALUES(?,?,?)",
                       [(h, t, track_id) for h, t in pairs])
        db.commit()
    finally:
        db.close()
    out({"ok": True, "ingested": args.audio, "title": args.title,
         "artist": args.artist, "hashes": len(pairs), "db": args.db})


def cmd_match(args):
    if not os.path.exists(args.audio):
        die("audio file not found: " + args.audio)
    if not os.path.exists(args.db):
        die("reference db not found: " + args.db, 2)
    pairs = analyze(args.audio)
    if not pairs:
        die("no fingerprints extracted from query audio")
    db = open_db(args.db)
    try:
        # inverted index: fetch references for each query hash.
        # A hash can occur at MANY query times (hash encodes only f1,f2,dt),
        # so keep every query time per hash — each (ref,query) pair votes.
        qtimes = {}
        for h, t in pairs:
            qtimes.setdefault(h, []).append(t)
        qhashes = list(qtimes.keys())
        refs = {}
        chunk = 900
        for i in range(0, len(qhashes), chunk):
            part = qhashes[i:i + chunk]
            marks = ",".join("?" * len(part))
            for h, t, tid in db.execute(
                f"SELECT hash, t, track_id FROM hashes WHERE hash IN ({marks})",
                part,
            ):
                refs.setdefault(tid, []).append((h, t))
        if not refs:
            out({"ok": True, "match": False, "reason": "no hash overlap",
                 "query_hashes": len(pairs)})
            return
        tracks = {row[0]: row for row in db.execute(
            "SELECT id, title, artist, source, hash_count FROM tracks")}
        best = None
        for tid, hits in refs.items():
            # offset histogram: coherent (refT - queryT) bin = true alignment
            offsets = {}
            for h, t in hits:
                for qt in qtimes.get(h, ()):
                    off = t - qt
                    offsets[off] = offsets.get(off, 0) + 1
            # allow +-1 frame jitter: smooth over 3 bins
            best_off, best_score = 0, 0
            for off in offsets:
                score = (offsets.get(off - 1, 0) + offsets.get(off, 0)
                         + offsets.get(off + 1, 0))
                if score > best_score:
                    best_off, best_score = off, score
            if best is None or best_score > best[1]:
                best = (tid, best_score, best_off, len(hits))
        tid, score, offset, raw_hits = best
        if score < MIN_HITS:
            out({"ok": True, "match": False, "reason": "below threshold",
                 "best_coherent": score, "query_hashes": len(pairs)})
            return
        tid, title, artist, source, hash_count = tracks[tid]
        conf = min(1.0, score / max(1.0, min(len(pairs), hash_count or 1)))
        offset_sec = round(offset * HOP / SR, 2)
        result = {
            "ok": True, "match": True,
            "title": title, "artist": artist,
            "source": source,
            "confidence": round(conf, 3),
            "coherent_hashes": score,
            "raw_hash_hits": raw_hits,
            "offset_seconds": offset_sec,
            "query_hashes": len(pairs),
            "reference_hashes": hash_count,
        }
        if args.json:
            out(result)
        else:
            artist_s = f" — {artist}" if artist else ""
            print(f"MATCH: {title}{artist_s}")
            print(f"confidence={conf:.0%} coherent={score} offset={offset_sec:+.2f}s")
    finally:
        db.close()


def cmd_stats(args):
    db_exists = os.path.exists(args.db)
    data = {"ok": True, "db": args.db, "exists": db_exists, "tracks": 0, "hashes": 0,
            "items": []}
    if db_exists:
        db = open_db(args.db)
        try:
            tracks_row = db.execute("SELECT COUNT(*) FROM tracks").fetchone()
            hashes_row = db.execute("SELECT COUNT(*) FROM hashes").fetchone()
            data["tracks"] = tracks_row[0] if tracks_row else 0
            data["hashes"] = hashes_row[0] if hashes_row else 0
            for tid, title, artist, hc in db.execute(
                "SELECT id, title, artist, hash_count FROM tracks ORDER BY id"):
                data["items"].append({"id": tid, "title": title, "artist": artist,
                                      "hashes": hc})
        finally:
            db.close()
    out(data)


def main():
    ap = argparse.ArgumentParser(description="Landmark audio fingerprinting")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("ingest")
    p.add_argument("audio")
    p.add_argument("--title", required=True)
    p.add_argument("--artist")
    p.add_argument("--source")
    p.add_argument("--db", default=DB_DEFAULT)
    p.set_defaults(fn=cmd_ingest)

    p = sub.add_parser("match")
    p.add_argument("audio")
    p.add_argument("--db", default=DB_DEFAULT)
    p.add_argument("--json", action="store_true")
    p.set_defaults(fn=cmd_match)

    p = sub.add_parser("stats")
    p.add_argument("--db", default=DB_DEFAULT)
    p.set_defaults(fn=cmd_stats)

    args = ap.parse_args()
    os.makedirs(os.path.dirname(args.db) or ".", exist_ok=True)
    args.fn(args)


if __name__ == "__main__":
    main()

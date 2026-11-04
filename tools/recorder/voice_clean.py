"""Clean up a volunteer's narration recording: even out the level, trim rumble, optionally denoise, WITHOUT moving any word.

Standard library + an ffmpeg/ffprobe binary on PATH (in Lambda: an ffmpeg layer puts them in /opt/bin). No AWS calls here, so it
runs the same on a laptop and in the pipeline. Pencil: every number below is a first guess to be tuned by ear.

  python voice_clean.py analyze  in.mp3
  python voice_clean.py plan     in.mp3 [--target -19.9]
  python voice_clean.py clean    in.mp3 out.mp3 [--target -19.9]       (prints the report; exit 1 if it REFUSED)

The three functions:
  analyze(path)              what is in the file: loudness, true peak, loudness range, noise floor, hum.
  plan(analysis, target)     which stages this file gets and with what settings (a plain dict, nothing runs).
  clean(src, dst, target)    runs the plan, VERIFIES the result against the original, and writes `dst` only if every check
                             passes. Otherwise it returns {"ok": False, "reasons": [...]} and writes nothing, so the caller
                             keeps the original. It does not raise for "the audio was not good enough"; it raises FfmpegMissing /
                             FfmpegError for "the machinery is broken" (a broken tool must be loud, not a silent fallback).

Terms (also defined in research/audio_cleanup_2026-11-01/RESULTS.md):
  LUFS      loudness, weighted like human hearing and averaged over the whole recording (EBU R128 / ITU BS.1770). Higher = louder.
            A mono file is measured as "dual mono" (the same sound in both speakers), because that is how a tablet plays it.
  true peak (dBTP) the highest the smooth sound wave reaches, which can sit above the highest stored sample. Above about -1 risks clipping.
  LRA       loudness range in LU: how far apart the quiet and loud passages are (the middle 90%).
  floor     rough background level between words: the 5th-percentile 50 ms level, dBFS. snr = speech(95th pct) - floor. Not
            standard metrics; good for comparing files with each other and one file before/after, nothing more.
  lag       how far the output is shifted in time against the original (cross-correlation). Positive = output later.
"""
import array
import json
import math
import operator
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

# ---------------------------------------------------------------------------------------------------------------------
# Settings (BEHAVIOR, pencil). One place, so anyone can change a number without reading the code.
# ---------------------------------------------------------------------------------------------------------------------
TARGET_LUFS = -19.9          # This is the Polly narrations' median measured the way a tablet plays it (see RESULTS.md).
                             # Other candidates: -16 (podcast/Apple convention, louder), -18 (AES streaming speech). The same target
                             # can be passed per call.
WORKING_LUFS = -23.0         # level the file is brought to BEFORE the compressor, so one threshold means the same on every file
PEAK_CEILING_DBFS = -3.0     # limiter ceiling (sample peaks); leaves room for inter-sample peaks and MP3 overshoot
TRUE_PEAK_MAX_DBTP = -1.0    # refuse above this, measured on the final MP3
LOUDNESS_TOL_LU = 1.0        # refuse if the final loudness is further than this from the target
LAG_TOL_MS = 1.0             # refuse if the output is shifted more than this
SAMPLE_TOL = 1               # refuse if the output length differs by more than this many samples
SNR_WORSE_MAX_DB = 3.0       # refuse if (speech - floor) got worse by more than this
HPF_HZ = 80
DENOISE_IF_FLOOR_ABOVE_DBFS = -60.0   # ACX's noise-floor ceiling (R1). Below this the file is left alone.
DENOISE_IF_SNR_BELOW_DB = 40.0        # or if speech sits less than this above the floor
NEURAL_FLAG_FLOOR_DBFS = -45.0        # above this classic denoise is not enough: flag for a human re-record / neural lane
AFFTDN = dict(nr=12, nf_offset_db=10, tn=0, gs=3)   # measured on the one noisy file (RESULTS.md): setting nf AT the measured floor
                                      # barely changes the noise (under 1 dB); nf about 10 dB above it removed ~4-6 dB of background
                                      # with under 1 dB lost from the 4-8 kHz band of s/f/z/ch words. tn=0 (no tracking), gs=3 (smoothing)
COMP = dict(threshold_db=-20, ratio=3, attack_ms=15, release_ms=250, knee_db=6, detection="rms")
# R1 starts at -30 dB. On a file brought to the working level that is below the average speech level, so it squeezed everything:
# 7-9 LU of gain reduction and 7-9 dB lost from speech-minus-floor (measured, RESULTS.md). -20 dB touches only the louder words.
LIMITER = dict(attack_ms=5, release_ms=60)
HUM_PROMINENCE_DB = 12.0     # a mains line this far above its neighbours, in the quiet parts, counts as hum
HUM_MIN_LEVEL_DBFS = -80.0
MAX_LIMITER_DB = 6.0         # more limiting than this is audible distortion; reported as the reason when the target is missed
MP3_KBPS_LOW, MP3_KBPS_HIGH = 96, 128   # mono speech: 96 for 24 kHz and below, 128 above
ENCODE_ATTEMPTS = 4          # re-render up to this many times to land the ENCODED file on target with a safe true peak


class FfmpegMissing(RuntimeError):
    """ffmpeg/ffprobe cannot be found. Loud on purpose: a silent 'skip cleaning' would hide a broken deployment."""


class FfmpegError(RuntimeError):
    """ffmpeg ran and failed."""


# ---------------------------------------------------------------------------------------------------------------------
# Running ffmpeg
# ---------------------------------------------------------------------------------------------------------------------
def _find(name):
    """Env override first (VOICE_CLEAN_FFMPEG / VOICE_CLEAN_FFPROBE), then PATH. Raises FfmpegMissing."""
    env = os.environ.get("VOICE_CLEAN_" + name.upper())
    if env:
        if os.path.isfile(env):
            return env
        raise FfmpegMissing(f"VOICE_CLEAN_{name.upper()} points at {env!r}, which is not a file.")
    found = shutil.which(name)
    if not found:
        raise FfmpegMissing(f"{name} not found on PATH. In Lambda, attach the ffmpeg layer (it provides /opt/bin/{name}); "
                            f"locally, install ffmpeg or set VOICE_CLEAN_{name.upper()}.")
    return found


def _ffmpeg(args):
    p = subprocess.run([_find("ffmpeg"), "-hide_banner", "-nostats", "-y", *args], capture_output=True)
    if p.returncode:
        raise FfmpegError("ffmpeg failed: " + p.stderr.decode("utf-8", "replace")[-600:])
    return p


def _raw_floats(path, rate, prefilter=""):
    """Decode to mono 32-bit float samples at `rate` (stdlib array)."""
    af = ["-af", prefilter] if prefilter else []
    p = _ffmpeg(["-i", path, *af, "-ac", "1", "-ar", str(rate), "-f", "f32le", "pipe:1"])
    a = array.array("f")
    a.frombytes(p.stdout[: len(p.stdout) // 4 * 4])
    if sys.byteorder == "big":
        a.byteswap()
    return a


def probe(path):
    out = subprocess.run([_find("ffprobe"), "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                         capture_output=True)
    if out.returncode:
        raise FfmpegError("ffprobe failed: " + out.stderr.decode("utf-8", "replace")[-400:])
    j = json.loads(out.stdout)
    s = next((x for x in j.get("streams", []) if x.get("codec_type") == "audio"), None)
    if not s:
        raise FfmpegError(f"{path} has no audio stream.")
    return {"rate": int(s["sample_rate"]), "channels": int(s["channels"]), "codec": s.get("codec_name"),
            "seconds": float(j["format"].get("duration") or s.get("duration") or 0),
            "kbps": round(int(j["format"].get("bit_rate") or 0) / 1000)}


def mono_filter(channels):
    """Fold to one channel: an even mix of two channels (a stereo file whose sides match comes out unchanged)."""
    if channels == 1:
        return "anull"
    if channels == 2:
        return "pan=mono|c0=0.5*c0+0.5*c1"
    return "aformat=channel_layouts=mono"


def count_samples(path, rate):
    """Number of samples after decoding to mono at `rate` (streamed, so a long file does not fill memory)."""
    p = subprocess.Popen([_find("ffmpeg"), "-hide_banner", "-nostats", "-v", "error", "-i", path, "-ac", "1", "-ar", str(rate),
                          "-f", "f32le", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    n = 0
    while True:
        block = p.stdout.read(1 << 20)
        if not block:
            break
        n += len(block)
    err = p.stderr.read()
    if p.wait():
        raise FfmpegError("ffmpeg failed while counting samples: " + err.decode("utf-8", "replace")[-400:])
    return n // 4


# ---------------------------------------------------------------------------------------------------------------------
# Measuring
# ---------------------------------------------------------------------------------------------------------------------
def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return float("-inf")


def loudness(path, prefilter="anull"):
    """Integrated loudness (LUFS), true peak (dBTP), loudness range (LU) via ffmpeg loudnorm's measuring pass, as dual mono."""
    p = _ffmpeg(["-i", path, "-af", f"{prefilter},loudnorm=I=-23:LRA=7:TP=-2:dual_mono=true:print_format=json", "-f", "null", "-"])
    err = p.stderr.decode("utf-8", "replace")
    try:
        j = json.loads(err[err.rindex("{"): err.rindex("}") + 1])
    except ValueError:
        raise FfmpegError("could not read loudnorm's measurement: " + err[-300:])
    return {"lufs": _f(j["input_i"]), "tp": _f(j["input_tp"]), "lra": _f(j["input_lra"])}


def frame_levels(path, rate, prefilter="anull"):
    """RMS level in dBFS of each 50 ms frame, sorted (digital silence, -inf, is dropped and counted)."""
    n = max(1, int(round(rate * 0.05)))
    p = _ffmpeg(["-i", path, "-af", f"{prefilter},asetnsamples=n={n}:p=0,astats=metadata=1:reset=1,"
                 "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"])
    txt = p.stdout.decode("utf-8", "replace")
    allv = re.findall(r"RMS_level=(-?inf|-?[\d.]+)", txt)
    vals = sorted(float(x) for x in allv if "inf" not in x)
    return vals, len(allv) - len(vals)


def _pct(sorted_vals, q):
    return sorted_vals[min(len(sorted_vals) - 1, int(q * len(sorted_vals)))]


def detect_hum(path, prefilter="anull"):
    """Look for a 50 or 60 Hz mains line (and its first harmonic) standing out in the QUIET parts of the file.
    Decodes to 500 Hz, takes up to 48 two-second blocks spread over the file, keeps the quietest third, and compares the power at
    the mains frequency with the median of its neighbours 3-8 Hz away (Hann window, Goertzel). Returns {found, freq, prominence_db,
    level_dbfs, harmonic}."""
    rate, blk = 500, 1000
    x = _raw_floats(path, rate, prefilter)
    nblk = len(x) // blk
    none = {"found": False, "freq": None, "prominence_db": 0.0, "level_dbfs": None, "harmonic": False}
    if nblk < 4:
        return none
    step = max(1, nblk // 48)
    win = [0.5 - 0.5 * math.cos(2 * math.pi * i / (blk - 1)) for i in range(blk)]
    wsum = sum(win)
    blocks = []
    for b in range(0, nblk, step):
        seg = x[b * blk:(b + 1) * blk]
        tot = sum(v * v for v in seg) / blk
        if tot > 1e-10:           # skip digital silence
            blocks.append((tot, seg))
    if len(blocks) < 3:
        return none
    blocks.sort(key=lambda t: t[0])
    quiet = blocks[: max(3, len(blocks) // 3)]

    def line_db(seg, hz):
        w = 2 * math.pi * hz / rate
        c = 2 * math.cos(w)
        s1 = s2 = 0.0
        for v, wv in zip(seg, win):
            s0 = v * wv + c * s1 - s2
            s2, s1 = s1, s0
        pw = s1 * s1 + s2 * s2 - c * s1 * s2
        return 20 * math.log10(max(math.sqrt(max(pw, 0.0)) * 2 / wsum, 1e-9))

    best = dict(none, strongest_prominence_db=0.0, strongest_freq=None)
    for mains in (50, 60):
        proms, levels, hproms = [], [], []
        for _, seg in quiet:
            ref = sorted(line_db(seg, mains + d) for d in (-8, -7, -6, -5, -4, -3, 3, 4, 5, 6, 7, 8))[5:7]
            lv = line_db(seg, mains)
            proms.append(lv - sum(ref) / 2)
            levels.append(lv)
            ref2 = sorted(line_db(seg, 2 * mains + d) for d in (-8, -6, -4, 4, 6, 8))[2:4]
            hproms.append(line_db(seg, 2 * mains) - sum(ref2) / 2)
        proms.sort()
        levels.sort()
        hproms.sort()
        mid = len(proms) // 2
        prom, lvl, hprom = proms[mid], levels[mid], hproms[len(hproms) // 2]
        if prom > best["strongest_prominence_db"]:
            best.update(strongest_prominence_db=round(prom, 1), strongest_freq=mains)      # reported even when below the bar
        if prom >= HUM_PROMINENCE_DB and lvl >= HUM_MIN_LEVEL_DBFS and prom > best["prominence_db"]:
            best.update(found=True, freq=mains, prominence_db=round(prom, 1), level_dbfs=round(lvl, 1),
                        harmonic=hprom >= HUM_PROMINENCE_DB)
    return best


def analyze(path):
    """Everything plan() needs, plus the numbers RESULTS.md reports. Read-only."""
    info = probe(path)
    mono = mono_filter(info["channels"])
    ld = loudness(path, mono)
    lv, silent = frame_levels(path, info["rate"], mono)
    out = {"file": os.path.basename(path), "seconds": round(info["seconds"], 1), "rate": info["rate"],
           "channels": info["channels"], "kbps": info["kbps"], "samples": count_samples(path, info["rate"]),
           "lufs": round(ld["lufs"], 1), "tp": round(ld["tp"], 1), "lra": round(ld["lra"], 1), "silent_frames": silent}
    if lv:
        floor, speech = _pct(lv, 0.05), _pct(lv, 0.95)
        out.update(floor=round(floor, 1), speech=round(speech, 1), snr=round(speech - floor, 1))
    else:
        out.update(floor=None, speech=None, snr=None)
    out["hum"] = detect_hum(path, mono)
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Planning (pure: a dict in, a dict out; nothing runs)
# ---------------------------------------------------------------------------------------------------------------------
def plan(analysis, target=None):
    """Pick the stages for one file. High-pass always; the rest only when the measurements call for them."""
    target = TARGET_LUFS if target is None else float(target)
    rate = int(analysis["rate"])
    p = {"target_lufs": target, "working_lufs": WORKING_LUFS, "rate": rate, "flags": [],
         "highpass": {"f": HPF_HZ, "poles": 2}, "notch": None, "denoise": None}
    hum = analysis.get("hum") or {}
    if hum.get("found"):
        p["notch"] = {"freqs": [hum["freq"]] + ([2 * hum["freq"]] if hum.get("harmonic") else []), "q": 30}
    floor, snr = analysis.get("floor"), analysis.get("snr")
    if floor is not None and (floor > DENOISE_IF_FLOOR_ABOVE_DBFS or (snr is not None and snr < DENOISE_IF_SNR_BELOW_DB)):
        n = rate // 40   # afftdn answers 25 ms late (R1, measured); this many samples are trimmed off the front and padded at the end
        p["denoise"] = {"nr": AFFTDN["nr"], "nf": int(max(-80, min(-20, round(floor + AFFTDN["nf_offset_db"])))), "tn": AFFTDN["tn"],
                        "gs": AFFTDN["gs"], "delay_samples": n}
        if floor > NEURAL_FLAG_FLOOR_DBFS:
            p["flags"].append("noise floor above -45 dBFS: classic denoising will not be enough; consider a re-record or the neural lane")
    p["compressor"] = dict(COMP)
    p["limiter"] = dict(LIMITER, ceiling_dbfs=PEAK_CEILING_DBFS)
    return p


def _pre_chain(p):
    """High-pass, optional hum notch, optional denoise (latency-compensated). Nothing that changes level."""
    c = [f"highpass=f={p['highpass']['f']}:poles={p['highpass']['poles']}"]
    if p["notch"]:
        c += [f"bandreject=f={f}:width_type=q:w={p['notch']['q']}" for f in p["notch"]["freqs"]]
    d = p["denoise"]
    if d:
        n = d["delay_samples"]
        c += [f"afftdn=nr={d['nr']}:nf={d['nf']}:tn={d['tn']}:gs={d['gs']}",
              f"atrim=start_sample={n}", "asetpts=PTS-STARTPTS", f"apad=pad_len={n}"]
    return ",".join(c)


def _comp_chain(p, gain_db):
    k = p["compressor"]
    return (f"volume={gain_db:.3f}dB,acompressor=threshold={k['threshold_db']}dB:ratio={k['ratio']}:attack={k['attack_ms']}:"
            f"release={k['release_ms']}:knee={k['knee_db']}dB:detection={k['detection']}:makeup=1")


def _limit_chain(p, gain_db, ceiling_dbfs):
    lim = p["limiter"]
    return (f"volume={gain_db:.3f}dB,alimiter=limit={10 ** (ceiling_dbfs / 20):.4f}:attack={lim['attack_ms']}:"
            f"release={lim['release_ms']}:level=disabled:latency=1")


# ---------------------------------------------------------------------------------------------------------------------
# Verifying (the part that makes "refuse" real)
# ---------------------------------------------------------------------------------------------------------------------
def xcorr_lag(src, dst, windows=4, window_s=1.0, search_ms=80):
    """Shift of `dst` against `src` in milliseconds (positive = dst later), from cross-correlation of the voice band (200-3000 Hz,
    8 kHz) over the loudest `windows` one-second stretches spread across the file. Returns {lag_ms, spread_ms, confidence, ok_range}.
    Several windows so a slow drift (tempo change) shows up as spread, not only a constant offset."""
    rate = 8000
    band = "highpass=f=200,lowpass=f=3000"
    a, b = _raw_floats(src, rate, band), _raw_floats(dst, rate, band)
    W, R = int(window_s * rate), int(search_ms * rate / 1000)
    n = min(len(a), len(b))
    none = {"lag_ms": None, "spread_ms": None, "confidence": 0.0, "ok_range": False}
    if n < W + 2 * R + 10:
        return none
    hop = rate // 2
    energy = [(sum(v * v for v in a[i:i + hop]), i) for i in range(R, n - W - R, hop)]
    chosen = []
    seg = max(1, len(energy) // windows)
    for s in range(0, len(energy), seg):
        best = max(energy[s:s + seg])
        if best[0] > 1e-6:
            chosen.append(best[1])
    lags, confs, at_edge = [], [], False
    for t0 in chosen:
        aw = a[t0:t0 + W]
        ea = sum(v * v for v in aw)
        c = []
        for lag in range(-R, R + 1):
            c.append(sum(map(operator.mul, aw, b[t0 + lag:t0 + lag + W])))
        k = max(range(len(c)), key=c.__getitem__)
        if k in (0, len(c) - 1):
            at_edge = True
        frac = 0.0
        if 0 < k < len(c) - 1:
            den = c[k - 1] - 2 * c[k] + c[k + 1]
            frac = 0.5 * (c[k - 1] - c[k + 1]) / den if den else 0.0
        lo = t0 + (k - R)
        eb = sum(v * v for v in b[lo:lo + W])
        confs.append(c[k] / math.sqrt(ea * eb) if ea > 0 and eb > 0 else 0.0)
        lags.append((k - R + frac) * 1000 / rate)
    if not lags:
        return none
    ls = sorted(lags)
    return {"lag_ms": round(ls[len(ls) // 2], 3), "spread_ms": round(ls[-1] - ls[0], 3),
            "confidence": round(min(confs), 3), "ok_range": not at_edge}


def verify(src, dst, target, before=None, after=None):
    """Compare a finished candidate with the original. Returns {ok, reasons, metrics}. `reasons` is empty when ok.
    Refuses on: sample count, shift, true peak, loudness, or a worse speech-minus-floor figure."""
    before = before or analyze(src)
    after = after or analyze(dst)
    reasons = []
    d_samples = after["samples"] - before["samples"]
    if after["rate"] != before["rate"]:
        reasons.append(f"sample rate changed {before['rate']} -> {after['rate']}")
    elif abs(d_samples) > SAMPLE_TOL:
        reasons.append(f"length changed by {d_samples:+d} samples (allowed +/-{SAMPLE_TOL})")
    lag = xcorr_lag(src, dst)
    if lag["lag_ms"] is None or not lag["ok_range"]:
        reasons.append("could not measure the shift against the original (no clear match within +/-80 ms)")
    elif lag["confidence"] < 0.3:
        reasons.append(f"output no longer matches the original well enough to check timing (match {lag['confidence']})")
    elif abs(lag["lag_ms"]) > LAG_TOL_MS or lag["spread_ms"] > LAG_TOL_MS:
        reasons.append(f"timing moved: lag {lag['lag_ms']} ms, spread {lag['spread_ms']} ms (allowed +/-{LAG_TOL_MS} ms)")
    if not math.isfinite(after["tp"]) or after["tp"] > TRUE_PEAK_MAX_DBTP:
        reasons.append(f"true peak {after['tp']} dBTP is above {TRUE_PEAK_MAX_DBTP} (clipping risk)")
    if not math.isfinite(after["lufs"]) or abs(after["lufs"] - target) > LOUDNESS_TOL_LU:
        reasons.append(f"loudness {after['lufs']} LUFS is not within {LOUDNESS_TOL_LU} LU of the target {target}")
    if before["snr"] is not None and after["snr"] is not None and after["snr"] < before["snr"] - SNR_WORSE_MAX_DB:
        reasons.append(f"speech-minus-floor fell from {before['snr']} to {after['snr']} dB (allowed drop {SNR_WORSE_MAX_DB} dB)")
    return {"ok": not reasons, "reasons": reasons,
            "metrics": {"samples_delta": d_samples, "lag": lag, "tp": after["tp"], "lufs": after["lufs"],
                        "snr_before": before["snr"], "snr_after": after["snr"]}}


# ---------------------------------------------------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------------------------------------------------
def clean(src, dst, target=None, rejected_path=None, workdir=None):
    """Run the chain on `src`, verify, and write `dst` only if every check passes.

    Returns a report dict: ok, reasons, warnings (passed but worth a listen), target_lufs, before, after, plan, stages (what ran,
    with the measurements between), verify (metrics), seconds. On ok=False `dst` is NOT written (and `rejected_path`, if given, gets the candidate for a listen).
    Raises FfmpegMissing / FfmpegError for machinery problems."""
    t0 = time.time()
    target = TARGET_LUFS if target is None else float(target)
    _find("ffmpeg"), _find("ffprobe")      # fail loudly and early
    before = analyze(src)
    p = plan(before, target)
    rate = before["rate"]
    mono = mono_filter(before["channels"])
    stages = []
    tmp = tempfile.mkdtemp(prefix="voice_clean_", dir=workdir)
    try:
        w1, w2, w3 = (os.path.join(tmp, n) for n in ("pre.wav", "comp.wav", "lim.wav"))
        cand = os.path.join(tmp, "cand.mp3")
        f32 = ["-c:a", "pcm_f32le", "-ar", str(rate)]
        # 1. shape: high-pass, hum notch, denoise (each added only when the plan says so)
        _ffmpeg(["-i", src, "-af", f"{mono},{_pre_chain(p)}", *f32, w1])
        m1 = loudness(w1)
        stages.append({"stage": "shape", "filters": _pre_chain(p), "after_lufs": round(m1["lufs"], 1)})
        # 2. working level + gentle compressor (the level it sees is the same for every file)
        g1 = WORKING_LUFS - m1["lufs"]
        _ffmpeg(["-i", w1, "-af", _comp_chain(p, g1), *f32, w2])
        m2 = loudness(w2)
        stages.append({"stage": "compress", "pre_gain_db": round(g1, 2), "after_lufs": round(m2["lufs"], 1),
                       "after_lra": round(m2["lra"], 1), "after_tp": round(m2["tp"], 1)})
        # 3. one constant gain to the target, then the limiter, then ONE mp3 encode. The limiter and the encoder each take a
        #    little loudness back, so the gain is nudged by the error measured on the ENCODED file (up to 4 tries); if the encoded
        #    true peak is too hot the ceiling drops 1.5 dB for the next try.
        ceiling, gain0 = p["limiter"]["ceiling_dbfs"], target - m2["lufs"]
        gain, reduction = gain0, 0.0
        kbps = MP3_KBPS_LOW if rate <= 24000 else MP3_KBPS_HIGH
        for attempt in range(ENCODE_ATTEMPTS):
            _ffmpeg(["-i", w2, "-af", _limit_chain(p, gain, ceiling), *f32, w3])
            _ffmpeg(["-i", w3, "-c:a", "libmp3lame", "-b:a", f"{kbps}k", "-ar", str(rate), "-ac", "1", cand])
            enc = loudness(cand)
            reduction = max(0.0, m2["tp"] + gain - ceiling)
            stages.append({"stage": "gain+limit+encode", "try": attempt + 1, "gain_db": round(gain, 2), "ceiling_dbfs": round(ceiling, 1),
                           "limiter_reduction_db_est": round(reduction, 1), "kbps": kbps, "after_lufs": round(enc["lufs"], 1),
                           "after_tp": round(enc["tp"], 1),
                           "loudness_lost_to_limit_and_encode_lu": round(m2["lufs"] + gain - enc["lufs"], 2)})
            err = target - enc["lufs"]
            hot = enc["tp"] > TRUE_PEAK_MAX_DBTP - 0.3
            if not hot and abs(err) <= 0.3:
                break
            if hot:
                ceiling -= 1.5
            if not math.isfinite(err) or gain - gain0 > 25:
                break
            gain += err
        after = analyze(cand)
        v = verify(src, cand, target, before, after)
        reasons = list(v["reasons"])
        if reasons and reduction > MAX_LIMITER_DB:
            reasons.append(f"reaching the target needed about {reduction:.1f} dB of limiting; more than {MAX_LIMITER_DB} dB sounds distorted")
        ok = not reasons
        warnings = list(p["flags"])
        if reduction > MAX_LIMITER_DB:
            warnings.append(f"the limiter had to take up to about {reduction:.1f} dB off the loudest peaks (more than {MAX_LIMITER_DB} dB can "
                            "sound crunchy): listen before trusting this file, or choose a lower target")
        if ok:
            os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
            shutil.move(cand, dst)
        elif rejected_path:
            os.makedirs(os.path.dirname(os.path.abspath(rejected_path)), exist_ok=True)
            shutil.move(cand, rejected_path)
        return {"ok": ok, "reasons": reasons, "target_lufs": target, "before": before, "after": after, "plan": p,
                "warnings": warnings, "stages": stages, "verify": v["metrics"], "seconds": round(time.time() - t0, 1)}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _main(argv):
    if len(argv) < 3 or argv[1] not in ("analyze", "plan", "clean"):
        print(__doc__)
        return 2
    target = float(argv[argv.index("--target") + 1]) if "--target" in argv else None
    args = [a for i, a in enumerate(argv[2:], 2) if a != "--target" and argv[i - 1] != "--target"]
    if argv[1] == "analyze":
        print(json.dumps(analyze(args[0]), indent=1))
    elif argv[1] == "plan":
        print(json.dumps(plan(analyze(args[0]), target), indent=1))
    else:
        rep = clean(args[0], args[1], target)
        print(json.dumps(rep, indent=1))
        return 0 if rep["ok"] else 1
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))

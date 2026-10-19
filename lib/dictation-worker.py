"""Bounded, offline CPU transcription. Never log audio or its transcription."""
import io
import json
import os
import stat
import sys

MAX_AUDIO = 8 * 1024 * 1024
MAX_SAMPLES = 90 * 16000


def local_directory(value):
    if not isinstance(value, str) or not os.path.isabs(value):
        raise ValueError("directory")
    if os.path.realpath(value) != value or not os.path.isdir(value):
        raise ValueError("directory")
    return value


def read_audio(value, model_directory):
    root = local_directory(os.path.join(os.path.dirname(model_directory), "temporaire"))
    if not isinstance(value, str) or os.path.dirname(value) != root:
        raise ValueError("audio path")
    descriptor = os.open(value, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_AUDIO:
            raise ValueError("audio size")
        with os.fdopen(descriptor, "rb", closefd=False) as audio:
            data = audio.read(MAX_AUDIO + 1)
        if len(data) != info.st_size:
            raise ValueError("audio changed")
    finally:
        os.close(descriptor)
    import av
    import numpy as np
    # Never probe playlists, nested resources or arbitrary FFmpeg protocols.
    # Audio submitted by the browser must be a self-contained known container.
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        format_name = "wav"
    elif data[:4] == b"\x1a\x45\xdf\xa3":
        format_name = "matroska"
    elif data[:4] == b"OggS":
        format_name = "ogg"
    elif data[4:8] == b"ftyp":
        format_name = "mov"
    else:
        raise ValueError("audio container")
    chunks = []
    samples = 0
    with av.open(io.BytesIO(data), mode="r", format=format_name, options={"protocol_whitelist": "pipe", "protocol_blacklist": "file,http,https,tcp,tls,udp,concat,subfile,data,ftp,sftp,crypto"}) as container:
        if not container.streams.audio:
            raise ValueError("missing audio")
        stream = container.streams.audio[0]
        stream.codec_context.thread_count = 2
        if stream.codec_context.channels > 8 or stream.codec_context.sample_rate > 192000:
            raise ValueError("audio parameters")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                samples += converted.samples
                if samples > MAX_SAMPLES:
                    raise ValueError("audio duration")
                chunks.append(converted.to_ndarray().reshape(-1))
        for converted in resampler.resample(None):
            samples += converted.samples
            if samples > MAX_SAMPLES:
                raise ValueError("audio duration")
            chunks.append(converted.to_ndarray().reshape(-1))
    if samples < 1600:
        raise ValueError("short audio")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def main():
    task = json.loads(sys.stdin.read(12000))
    language = task.get("language")
    if language not in ("fr", "en", "nl"):
        raise ValueError("language")
    model_directory = local_directory(task.get("modelDirectory"))
    for filename in ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt"):
        entry = os.path.join(model_directory, filename)
        if os.path.islink(entry) or not os.path.isfile(entry):
            raise ValueError("model")
    audio = None if task.get("verify") is True else read_audio(task.get("audioPath"), model_directory)
    from faster_whisper import WhisperModel
    model = WhisperModel(model_directory, device="cpu", compute_type="int8", cpu_threads=4, num_workers=1, local_files_only=True)
    if task.get("verify") is True:
        print(json.dumps({"ok": True, "text": "", "language": language, "duration": 0}))
        return
    segments, _ = model.transcribe(audio, language=language, beam_size=5, condition_on_previous_text=False, vad_filter=True, vad_parameters={"min_silence_duration_ms": 500}, suppress_blank=True)
    text = " ".join(segment.text.strip() for segment in segments)
    text = "".join(character for character in text if ord(character) >= 32 or character in "\n\t")[:16000]
    print(json.dumps({"ok": True, "text": text, "language": language, "duration": len(audio) / 16000}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({"ok": False, "error": "transcription_failed"}))
        sys.exit(1)

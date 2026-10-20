"""Private local worker: released Pocket presets only, no audio prompt or network."""
import contextlib
import json
import os
from pathlib import Path
import sys
import threading
import time

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
    os.environ.pop(key, None)

OUTPUT = sys.stdout
LOCK = threading.Lock()
ACTIVE = {}
MODELS = {}
STATES = {}
VARIANTS = {"fr": "french_24l", "en": "english", "nl": "dutch"}
VOICES = {"studio-oscar-paul-v2": "paul-v2", "studio-oscar-2": "charles", "studio-zoe": "zoe", "studio-zoe-vera-v2": "vera-v2"}

def local_path(value, exists=True):
    target = Path(value)
    if not target.is_absolute() or target.resolve(strict=exists) != target:
        raise ValueError("Local voice path required")
    return target

def new_wave_file(output, pack):
    output = Path(output)
    if output.parent != pack.parent / "cache":
        raise ValueError("Local voice cache required")
    local_path(output.parent)
    return os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), "wb")

def send(value):
    with LOCK:
        OUTPUT.write(json.dumps(value, ensure_ascii=False) + "\n")
        OUTPUT.flush()

def model_for(language, pack):
    from pocket_tts import TTSModel
    import pocket_tts
    import yaml
    variant = VARIANTS[language]
    if language not in MODELS:
        original = Path(pocket_tts.__file__).parent / "config" / (variant + ".yaml")
        config = yaml.safe_load(original.read_text())
        config["weights_path"] = str(pack / variant / "model.safetensors")
        config["weights_path_without_voice_cloning"] = None
        config["flow_lm"]["lookup_table"]["tokenizer_path"] = str(pack / variant / "tokenizer.json")
        def has_remote(value):
            if isinstance(value, str):
                return value.startswith(("hf://", "http://", "https://"))
            if isinstance(value, dict):
                return any(has_remote(item) for item in value.values())
            if isinstance(value, list):
                return any(has_remote(item) for item in value)
            return False
        if has_remote(config):
            raise ValueError("Offline configuration required")
        local = pack / variant / "local-config.yaml"
        # No remote URL survives this fixed configuration; no arbitrary voice is accepted.
        local_path(local.parent)
        with os.fdopen(os.open(local, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600), "w") as destination:
            destination.write(yaml.safe_dump(config))
        model = TTSModel.load_model(config=local)
        model.has_voice_cloning = False
        MODELS[language] = model
    return MODELS[language]

def generate(task, stop):
    import numpy as np
    from scipy.io.wavfile import write
    import torch
    started = time.monotonic()
    def finish(value):
        # The stdin reader may receive the next request immediately after this
        # acknowledgement. Release this request before writing the message.
        if ACTIVE.get("id") == task.get("id"):
            ACTIVE.clear()
        send(value)
    try:
        language = task.get("language")
        voice_id = task.get("voiceId")
        text = task.get("text")
        if language not in VARIANTS or voice_id not in VOICES or not isinstance(text, str) or not 1 <= len(text) <= 500:
            raise ValueError("Invalid request")
        pack = local_path(task["pack"])
        local_path(pack / VARIANTS[language])
        for name in ("model.safetensors", "tokenizer.json", VOICES[voice_id] + ".safetensors"):
            local_path(pack / VARIANTS[language] / name)
        model = model_for(language, pack)
        key = (language, voice_id)
        if key not in STATES:
            embedding = pack / VARIANTS[language] / (VOICES[voice_id] + ".safetensors")
            STATES[key] = model.get_state_for_audio_prompt(str(embedding))
        if stop.is_set():
            finish({"id": task["id"], "cancelled": True})
            return
        chunks = []
        for chunk in model.generate_audio_stream(STATES[key], text, stop=stop):
            if stop.is_set():
                break
            chunks.append(chunk)
        if stop.is_set():
            finish({"id": task["id"], "cancelled": True})
            return
        if not chunks:
            raise ValueError("No speech")
        audio = torch.cat(chunks).numpy()
        if audio.size > 4 * 1024 * 1024 or not np.isfinite(audio).all():
            raise ValueError("Invalid speech")
        audio = np.clip(audio, -1, 1)
        with new_wave_file(task["output"], pack) as destination:
            write(destination, model.sample_rate, (audio * 32767).astype(np.int16))
        finish({"id": task["id"], "ok": True, "seconds": time.monotonic() - started, "audioSeconds": audio.size / model.sample_rate})
    except Exception:
        finish({"id": task.get("id"), "ok": False})
    finally:
        if ACTIVE.get("id") == task.get("id"):
            ACTIVE.clear()

def main():
    # Library diagnostics go to stderr; stdout is exclusively JSON protocol.
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        torch.set_num_threads(1)  # Pocket's decoder uses the second CPU thread.
        send({"ready": True})
        for line in sys.stdin:
            try:
                if len(line) > 12000:
                    continue
                task = json.loads(line)
                if task.get("type") == "cancel":
                    if task.get("id") == ACTIVE.get("id"):
                        ACTIVE["stop"].set()
                    continue
                if task.get("type") == "shutdown":
                    if ACTIVE:
                        ACTIVE["stop"].set()
                    break
                if task.get("type") != "speak" or ACTIVE:
                    send({"id": task.get("id"), "ok": False})
                    continue
                stop = threading.Event()
                ACTIVE.update(id=task.get("id"), stop=stop)
                threading.Thread(target=generate, args=(task, stop), daemon=True).start()
            except Exception:
                send({"ok": False})

if __name__ == "__main__":
    main()

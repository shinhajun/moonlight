"""Jev-compatible /v1/systemone server for Laya checkpoints, as the Moonlight agent expects it."""
import hashlib
import os
import threading
import time
from typing import Any, Dict, Optional

import laya
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import JSONResponse
from laya.confidence import jev_confidence

# Public catalog names -> (Hugging Face repo, subfolder).
PUBLIC = {
    "laya-base": ("convaiinnovations/laya", None),
    "laya-multilingual": ("convaiinnovations/laya", "multilingual"),
}


def weights_digest(repo_or_dir: str, subfolder: Optional[str]) -> str:
    """sha256 of model.safetensors, the reference digest Moonlight compares at hello."""
    if os.path.isdir(repo_or_dir):
        path = os.path.join(repo_or_dir, subfolder or "", "model.safetensors")
    else:
        from huggingface_hub import hf_hub_download
        path = hf_hub_download(repo_or_dir, "model.safetensors", subfolder=subfolder)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest()


class Model:
    def __init__(self, model_id: str, source: str, subfolder: Optional[str], device: Optional[str], private: bool):
        t = time.perf_counter()
        self.agent = laya.load(source, device=device, subfolder=subfolder)
        self.model_id = model_id
        self.private = private
        self.digest = weights_digest(source, subfolder)
        self.device = str(self.agent.device)
        self.lock = threading.Lock()
        print(f"loaded {model_id} on {self.device} in {time.perf_counter() - t:.1f}s  sha256:{self.digest[:12]}", flush=True)

    def info(self) -> Dict[str, Any]:
        return {"model_id": self.model_id, "digest": self.digest, "kind": "decision", "private": self.private}


def to_jev(result: Dict[str, Any], model_id: str) -> Dict[str, Any]:
    """Project Laya's result onto TypeSafe Jev's response shape (field names and order)."""
    answers = {}
    for qid, a in result["answers"].items():
        kind = a.get("type")
        if kind == "noul":
            answers[qid] = {"type": "noul", "noul": a["noul"]}
        elif kind == "choice":
            answers[qid] = {"type": "choice", "choice": a["choice"], "confidence": round(jev_confidence(a), 4),
                            "probabilities": a["probabilities"]}
        elif kind == "score":
            answers[qid] = {"type": "score", "score": a["score"], "confidence": round(jev_confidence(a), 4),
                            "legend": a["legend"], "probabilities": a["probabilities"]}
        else:
            answers[qid] = a
    usage = result.get("usage") or {}
    return {"model": model_id, "answers": answers,
            "usage": {"input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0)}}


def create_app(models: Dict[str, Model]) -> FastAPI:
    primary = next(iter(models.values()))
    app = FastAPI(title="laya-runner")

    @app.get("/health")
    def health():
        return {"model_id": primary.model_id, "digest": primary.digest, "device": primary.device,
                "models": [m.info() for m in models.values()]}

    # A sync handler runs in FastAPI's thread pool; each model answers one request at a time.
    @app.post("/v1/systemone")
    def systemone(body: Dict[str, Any] = Body(...)):
        questions = body.get("questions")
        if not isinstance(questions, dict) or not questions:
            raise HTTPException(422, "body needs a non-empty 'questions' object")
        model = models.get(body.get("model") or primary.model_id)
        if model is None:
            raise HTTPException(404, f"model {body.get('model')!r} is not served here; have {sorted(models)}")
        t = time.perf_counter()
        try:
            with model.lock:
                result = model.agent.predict(body.get("state"), questions)
        except (ValueError, TypeError) as e:  # Laya names the malformed question or state
            raise HTTPException(422, str(e))
        ms = (time.perf_counter() - t) * 1000
        print(f"systemone {model.model_id} q={len(questions)} {ms:.0f}ms", flush=True)
        return JSONResponse(to_jev(result, model.model_id), headers={"X-Inference-Time-Ms": f"{ms:.2f}"})

    return app

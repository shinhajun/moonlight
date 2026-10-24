"""Serve Laya decision models on :8765 for the Moonlight agent (laya-runner, or python -m laya_runner)."""
import argparse
import os

os.environ.setdefault("USE_TF", "0")  # transformers' TensorFlow probe can deadlock model construction


def main() -> None:
    p = argparse.ArgumentParser(prog="laya-runner", description=__doc__)
    p.add_argument("--host", default="127.0.0.1", help="bind address (default 127.0.0.1; the agent runs on the same machine)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--device", default="auto", help="auto (cuda, then mps, then cpu), cpu, cuda or mps")
    p.add_argument("--models", default="laya-base", help="public checkpoints to serve, comma separated: laya-base, laya-multilingual")
    p.add_argument("--private", action="append", default=[], metavar="HANDLE/NAME=DIR",
                   help="also serve a local checkpoint directory as a private model, e.g. hajun/support-triage=./checkpoints/support-triage")
    args = p.parse_args()

    from .server import PUBLIC, Model, create_app

    device = None if args.device == "auto" else args.device
    models = {}
    for name in filter(None, (m.strip() for m in args.models.split(","))):
        if name not in PUBLIC:
            p.error(f"unknown public model {name!r}; choose from {', '.join(PUBLIC)}")
        repo, sub = PUBLIC[name]
        models[name] = Model(name, repo, sub, device, private=False)
    for spec in args.private:
        name, sep, path = spec.partition("=")
        if not sep or "/" not in name or not os.path.isdir(path):
            p.error(f"--private wants HANDLE/NAME=DIR with an existing directory, got {spec!r}")
        models[name] = Model(name, os.path.abspath(path), None, device, private=True)
    if not models:
        p.error("nothing to serve")

    import uvicorn
    print(f"laya-runner on http://{args.host}:{args.port}  models: {', '.join(models)}", flush=True)
    uvicorn.run(create_app(models), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

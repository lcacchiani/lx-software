"""Build a local Lambda bundle for CDK asset staging."""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
import shutil
import subprocess
import sys

logger = logging.getLogger(__name__)


def _ensure_python_version() -> None:
    if sys.version_info[:2] != (3, 12):
        raise SystemExit("Python 3.12 is required to build Lambda bundles.")


def _run_pip(command: list[str], cwd: Path, env: dict[str, str]) -> None:
    subprocess.run(command, check=True, cwd=cwd, env=env)


def _copy_tree(source: Path, destination: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(f"Missing source path: {source}")
    shutil.copytree(source, destination, dirs_exist_ok=True)


def _cleanup_bundle(output_dir: Path) -> None:
    for cache_dir in output_dir.rglob("__pycache__"):
        shutil.rmtree(cache_dir)
    for cache_file in output_dir.rglob("*.pyc"):
        cache_file.unlink()
    for cache_file in output_dir.rglob("*.pyo"):
        cache_file.unlink()


def build_bundle(source_root: Path, output_dir: Path) -> None:
    requirements = source_root / "requirements.txt"
    if not requirements.is_file():
        raise FileNotFoundError(f"Missing requirements file: {requirements}")

    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update(
        {
            "HOME": "/tmp",
            "PIP_CACHE_DIR": "/tmp/pip-cache",
            "PYTHONUSERBASE": "/tmp/.local",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONHASHSEED": "0",
        }
    )

    _run_pip(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--upgrade",
            "pip",
            "--no-warn-script-location",
        ],
        cwd=source_root,
        env=env,
    )
    _run_pip(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            "requirements.txt",
            "-t",
            str(output_dir),
            "--no-compile",
        ],
        cwd=source_root,
        env=env,
    )

    _copy_tree(source_root / "lambda", output_dir / "lambda")
    _copy_tree(source_root / "src", output_dir / "src")
    _cleanup_bundle(output_dir)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root",
        default=str(Path(__file__).resolve().parents[1]),
        help="Path to backend source root.",
    )
    parser.add_argument(
        "--output-dir",
        default="",
        help="Output directory for the bundled assets.",
    )
    return parser.parse_args()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    _ensure_python_version()
    args = _parse_args()
    source_root = Path(args.source_root).resolve()
    output_dir = (
        Path(args.output_dir).resolve()
        if args.output_dir
        else source_root / ".lambda-build" / "base"
    )
    logger.info("Building Lambda bundle in %s", output_dir)
    build_bundle(source_root, output_dir)
    logger.info("Lambda bundle ready.")


if __name__ == "__main__":
    main()

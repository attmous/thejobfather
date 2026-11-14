"""Package the current source for judges, excluding secrets and local state."""
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
destination = root / "artifacts" / "thejobfather-judge-kit.zip"
allowed_roots = {"assets", "backend", "frontend", "docs", "scripts", ".github"}
allowed_files = {"README.md", "Brewfile", "compose.yaml", ".dockerignore", ".gitignore", ".env.example"}
excluded_parts = {"node_modules", ".next", ".venv", "__pycache__", "data", ".git", ".openai"}
names = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
).decode().split("\0")
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(set(filter(None, names))):
        relative = Path(name)
        source = root / relative
        if relative.parts[0] not in allowed_roots and name not in allowed_files:
            continue
        if not source.is_file() or source.is_symlink() or excluded_parts.intersection(relative.parts):
            continue
        if relative.name.startswith(".env") and relative.name != ".env.example":
            continue
        if relative.suffix in {".db", ".sqlite", ".sqlite3", ".key", ".pyc", ".tsbuildinfo"}:
            continue
        archive.write(source, "thejobfather/" + relative.as_posix())
print(destination)

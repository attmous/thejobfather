import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote, unquote, urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationInfo, field_validator

MAX_TEXT = 60_000
MAX_PROFILE_URL = 512
DB_PATH = Path(
    os.environ.get("JOBFATHER_DB", Path(__file__).resolve().parents[2] / "data/profile.sqlite3")
)


class ProfileDetails(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(default="", max_length=160)
    role: str = Field(default="", max_length=200)
    summary: str = Field(default="", max_length=3000)
    experience: str = Field(default="", max_length=MAX_TEXT)
    skills: str = Field(default="", max_length=2000)
    contact: str = Field(default="", max_length=400)
    work_history: str = Field(default="", max_length=6000)
    projects: str = Field(default="", max_length=6000)
    education: str = Field(default="", max_length=4000)
    certifications: str = Field(default="", max_length=4000)


class ResumeSource(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    kind: Literal["pdf", "docx", "text"]
    label: str = Field(min_length=1, max_length=255)
    stored: bool = False


class ApprovedEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    kind: Literal["github", "linkedin"]
    label: str = Field(min_length=1, max_length=255)
    text: str = Field(min_length=1, max_length=6000)
    url: Optional[str] = Field(default=None, max_length=512)


class Profile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=0)
    details: ProfileDetails
    resume: Optional[ResumeSource] = None
    resume_details: Optional[ProfileDetails] = Field(default=None, repr=False)
    evidence: list[ApprovedEvidence] = Field(default_factory=list, max_length=2)
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None


class ProfileLinks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=0)
    github_url: str = Field(default="", max_length=MAX_PROFILE_URL)
    linkedin_url: str = Field(default="", max_length=MAX_PROFILE_URL)

    @field_validator("github_url", "linkedin_url")
    @classmethod
    def normalize_profile_link(cls, value: str, info: ValidationInfo) -> str:
        value = value.strip()
        if not value:
            return ""
        github = info.field_name == "github_url"
        service = "GitHub" if github else "LinkedIn"
        message = f"Enter a {service} profile link."
        try:
            url = urlsplit(value if "://" in value else "https://" + value)
            if url.scheme not in ("http", "https") or url.username is not None or url.port is not None:
                raise ValueError
            host = url.hostname or ""
            path = unquote(url.path).rstrip("/")
            if github and host in ("github.com", "www.github.com"):
                if len(path) <= 40 and re.fullmatch(r"/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*", path):
                    return "https://github.com" + path
            if not github and re.fullmatch(r"(?:(?:www|[a-z]{2})\.)?linkedin\.com", host):
                if re.fullmatch(r"/in/[\w.-]{1,100}", path):
                    return "https://www.linkedin.com" + quote(path)
        except ValueError:
            pass
        raise ValueError(message)


class ProfileSources(ProfileLinks):
    resume_text: str = Field(default="", max_length=MAX_TEXT)


def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(DB_PATH, timeout=5)


def initialize():
    with closing(connect()) as db, db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                version INTEGER NOT NULL,
                payload TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS profile_resume (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                contents BLOB NOT NULL
            )
        """)


def read_profile_from(db: sqlite3.Connection) -> Profile:
    row = db.execute("SELECT payload FROM profile WHERE id = 1").fetchone()
    return Profile.model_validate_json(row[0]) if row else Profile(version=0, details=ProfileDetails())


def read_profile() -> Profile:
    with closing(connect()) as db:
        return read_profile_from(db)


def write_profile(db: sqlite3.Connection, profile: Profile) -> None:
    db.execute(
        """INSERT INTO profile (id, version, payload) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET version = excluded.version, payload = excluded.payload""",
        (profile.version, profile.model_dump_json()),
    )


def save_profile(profile: Profile, *, original_resume: Optional[bytes] = None) -> Optional[Profile]:
    with closing(connect()) as db, db:
        db.execute("BEGIN IMMEDIATE")
        current = read_profile_from(db)
        if profile.version != current.version:
            return None
        updated = profile.model_copy(update={"version": profile.version + 1})
        if original_resume is not None:
            if updated.resume is None:
                raise ValueError("A stored resume needs its source metadata.")
            db.execute("""INSERT INTO profile_resume (id, contents) VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET contents = excluded.contents""", (original_resume,))
            updated.resume = updated.resume.model_copy(update={"stored": True})
        elif profile.resume != current.resume:
            db.execute("DELETE FROM profile_resume WHERE id = 1")
            if updated.resume:
                updated.resume = updated.resume.model_copy(update={"stored": False})
        write_profile(db, updated)
    return updated

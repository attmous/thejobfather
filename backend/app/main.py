import os
from contextlib import asynccontextmanager, closing
from io import BytesIO
from typing import Optional
from urllib.parse import quote, unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse, Response

from .profile import (
    MAX_TEXT, ApprovedEvidence, Profile, ProfileDetails, ProfileLinks, ProfileSources, ResumeSource,
    connect, initialize, read_profile, read_profile_from, save_profile,
)
from .gemini import GeminiError
from .fit import initialize_fit
from .application import initialize_application, router as application_router
from .job import initialize_job, router as job_router
from .live import router as live_router
from .resume import extract_resume_pdf, extract_resume_text, read_docx, read_pdf_text
from .session import initialize_session, keep_approved_facts, router as session_router
from .settings import router as settings_router

MAX_PDF_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 50


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize()
    initialize_job()
    initialize_session()
    initialize_application()
    initialize_fit()
    yield


app = FastAPI(title="TheJobFather", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=[
    host.strip() for host in os.environ.get(
        "JOBFATHER_ALLOWED_HOSTS", "localhost,127.0.0.1"
    ).split(",") if host.strip()
])
app.include_router(settings_router)
app.include_router(job_router)
app.include_router(session_router)
app.include_router(live_router)
app.include_router(application_router)
APP_ORIGINS = {
    origin.strip() for origin in os.environ.get(
        "JOBFATHER_ORIGINS", "http://127.0.0.1:3000,http://localhost:3000"
    ).split(",") if origin.strip()
}


@app.exception_handler(GeminiError)
async def gemini_error(_: Request, error: GeminiError):
    return JSONResponse(
        {"detail": str(error), "code": "gemini_import"},
        status_code=error.status_code,
    )


@app.middleware("http")
async def local_requests(request: Request, call_next):
    origin = request.headers.get("origin")
    settings_write = request.url.path.rstrip("/").startswith("/api/settings/")
    if request.method not in ("GET", "HEAD", "OPTIONS") and (origin or settings_write) and origin not in APP_ORIGINS:
        return JSONResponse({"detail": "Request must come from the app."}, status_code=403)
    if request.url.path in ("/api/profile/import/pdf", "/api/profile/sources/pdf", "/api/profile/sources/docx", "/api/profile/evidence/linkedin/pdf"):
        size = request.headers.get("content-length")
        if size and size.isdecimal() and int(size) > MAX_PDF_BYTES:
            return JSONResponse({"detail": "Choose a file up to 10 MB."}, status_code=413)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    if request.url.path.rstrip("/") == "/api/settings/gemini":
        return JSONResponse({"detail": "Enter a Gemini API key."}, status_code=422)
    if request.url.path.rstrip("/") == "/api/settings/text":
        return JSONResponse({"detail": "Check the provider, model ID, and API key."}, status_code=422)
    if request.url.path == "/api/job/import/link":
        return JSONResponse({"detail": "Enter a public job link."}, status_code=422)
    if request.url.path == "/api/profile/sources":
        return JSONResponse({"detail": profile_input_error(error)}, status_code=422)
    return await request_validation_exception_handler(request, error)


class ResumeText(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=MAX_TEXT)


class ImportResult(BaseModel):
    details: ProfileDetails
    resume: ResumeSource


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/profile", response_model=Profile)
def get_profile():
    return read_profile()


@app.put("/api/profile", response_model=Profile)
def put_profile(profile: Profile):
    if not profile.details.name:
        raise HTTPException(422, "Enter your name before saving.")
    saved = save_profile(profile)
    if saved is None:
        raise HTTPException(409, "The profile changed in another tab. Reload before saving again.")
    return saved


def profile_input_error(error):
    for item in error.errors():
        field = item["loc"][-1] if item["loc"] else None
        if field == "github_url":
            return "Enter a GitHub profile link."
        if field == "linkedin_url":
            return "Enter a LinkedIn profile link."
        if field == "resume_text":
            return "Keep your resume text under 60,000 characters."
    return "Couldn’t read the profile inputs. Try again."


def current_profile_for(links: ProfileLinks) -> Profile:
    profile = read_profile()
    if profile.version != links.version:
        raise HTTPException(409, "The profile changed in another tab. Reload before saving again.")
    return profile


def save_sources(
    current: Profile, links: ProfileLinks,
    imported: Optional[ImportResult] = None, original_resume: Optional[bytes] = None,
) -> Profile:
    updated = current.model_copy(update={
        "github_url": links.github_url or None,
        "linkedin_url": links.linkedin_url or None,
    })
    if imported:
        if not imported.details.name:
            raise HTTPException(422, "Couldn’t find your name in the resume. Include it and try again.")
        updated.resume_details = imported.details
        updated.details = keep_approved_facts(current, imported.details)
        updated.resume = imported.resume
    elif not current.version:
        raise HTTPException(422, "Upload a PDF or DOCX, or paste your resume text.")
    elif updated == current:
        return current

    saved = save_profile(updated, original_resume=original_resume)
    if saved is None:
        raise HTTPException(409, "The profile changed in another tab. Reload before saving again.")
    return saved


@app.put("/api/profile/sources", response_model=Profile)
def save_profile_sources(inputs: ProfileSources):
    current = current_profile_for(inputs)
    if not inputs.resume_text.strip():
        return save_sources(current, inputs)
    imported = import_text(ResumeText(text=inputs.resume_text))
    return save_sources(current, inputs, imported, inputs.resume_text.encode("utf-8"))


@app.put("/api/profile/sources/pdf", response_model=Profile)
async def save_profile_pdf(request: Request):
    return await save_resume_upload(request, "pdf")


@app.put("/api/profile/sources/docx", response_model=Profile)
async def save_profile_docx(request: Request):
    return await save_resume_upload(request, "docx")


async def save_resume_upload(request: Request, kind: str):
    try:
        links = ProfileLinks.model_validate_json(unquote(request.headers.get("x-profile-sources", "")))
    except ValidationError as error:
        raise HTTPException(422, profile_input_error(error)) from None
    current = await run_in_threadpool(current_profile_for, links)
    contents, label = await read_document_upload(request, kind)
    if kind == "docx":
        text = await run_in_threadpool(read_docx, contents)
        details = await run_in_threadpool(extract_resume_text, text)
        imported = ImportResult(details=details, resume=ResumeSource(kind="docx", label=label[:255]))
    else:
        imported = await run_in_threadpool(parse_pdf, contents, label)
    return await run_in_threadpool(save_sources, current, links, imported, bytes(contents))


@app.get("/api/profile/resume")
def download_resume():
    with closing(connect()) as db:
        db.execute("BEGIN")
        resume = read_profile_from(db).resume
        row = db.execute("SELECT contents FROM profile_resume WHERE id = 1").fetchone()
    if not resume or not resume.stored or not row:
        raise HTTPException(404, "Upload a new resume to save a downloadable copy.")
    media = {"pdf": "application/pdf", "text": "text/plain",
             "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    filename = quote("resume.txt" if resume.kind == "text" else resume.label, safe="")
    return Response(row[0], media_type=media[resume.kind], headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{filename}",
        "X-Content-Type-Options": "nosniff",
    })


@app.post("/api/profile/import/text", response_model=ImportResult)
def import_text(resume: ResumeText):
    return ImportResult(
        details=extract_resume_text(resume.text),
        resume=ResumeSource(kind="text", label="Pasted resume"),
    )


@app.post("/api/profile/import/pdf", response_model=ImportResult)
async def import_pdf(request: Request):
    contents, label = await read_document_upload(request)
    return await run_in_threadpool(parse_pdf, contents, label)


async def read_document_upload(request: Request, kind: str = "pdf") -> tuple[bytearray, str]:
    label = unquote(request.headers.get("x-resume-filename", "")).replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not label.lower().endswith("." + kind):
        raise HTTPException(415, f"Choose a {kind.upper()} file.")
    contents = bytearray()
    async for chunk in request.stream():
        if len(contents) + len(chunk) > MAX_PDF_BYTES:
            raise HTTPException(413, "Choose a file up to 10 MB.")
        contents.extend(chunk)
    return contents, label


def check_pdf(contents: bytearray) -> None:
    if not contents.startswith(b"%PDF-"):
        raise HTTPException(415, "This file is not a PDF.")
    try:
        reader = PdfReader(BytesIO(contents))
        if reader.is_encrypted:
            raise HTTPException(422, "This PDF is locked. Paste your resume text instead.")
        if len(reader.pages) > MAX_PDF_PAGES:
            raise HTTPException(422, "Choose a PDF with up to 50 pages or paste your resume text.")
    except (PdfReadError, ValueError, KeyError, IndexError, RecursionError, OSError):
        raise HTTPException(422, "Couldn’t read this PDF. Paste your resume text instead.") from None


def parse_pdf(contents: bytearray, label: str) -> ImportResult:
    check_pdf(contents)
    return ImportResult(
        details=extract_resume_pdf(contents),
        resume=ResumeSource(kind="pdf", label=label[:255]),
    )


@app.post("/api/profile/evidence/linkedin/pdf")
async def linkedin_pdf(request: Request):
    contents, label = await read_document_upload(request)
    await run_in_threadpool(check_pdf, contents)
    text = await run_in_threadpool(read_pdf_text, contents)
    return {"label": label[:255], "text": text[:6000]}


class RepositoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=512)


class EvidenceApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(gt=0)
    evidence: ApprovedEvidence


@app.put("/api/profile/evidence", response_model=Profile)
def approve_evidence(body: EvidenceApproval):
    from .sources import github_repository_url

    current = read_profile()
    if body.version != current.version:
        raise HTTPException(409, "The profile changed. Reload before approving evidence.")
    evidence = body.evidence
    if evidence.kind == "github":
        evidence.url = github_repository_url(evidence.url or "")[0]
    else:
        evidence.url = None
    current.evidence = [item for item in current.evidence if item.kind != evidence.kind] + [evidence]
    saved = save_profile(current)
    if saved is None:
        raise HTTPException(409, "The profile changed. Reload before approving evidence.")
    return saved


@app.delete("/api/profile/evidence/{kind}", response_model=Profile)
def remove_evidence(kind: str, version: int):
    current = read_profile()
    if version != current.version:
        raise HTTPException(409, "The profile changed. Reload before removing evidence.")
    evidence = [item for item in current.evidence if item.kind != kind]
    if evidence == current.evidence:
        return current
    current.evidence = evidence
    saved = save_profile(current)
    if saved is None:
        raise HTTPException(409, "The profile changed. Reload before removing evidence.")
    return saved


@app.post("/api/profile/evidence/github")
def preview_github(source: RepositoryInput):
    from .sources import github_preview

    return github_preview(source.url)

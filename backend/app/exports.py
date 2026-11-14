"""Versioned application exports and local PDF readiness checks."""
import re
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from pypdf import PdfReader

from .fit import normalize as normalize_requirement, score


def document_lines(run, kind):
    """Return the text and semantic roles shared by all output formats."""
    details = run.profile.details
    docs = run.documents
    if kind == "cv":
        yield "title", details.name
        if details.role:
            yield "subtitle", details.role
        if details.contact:
            yield "text", details.contact
        yield "heading", "Summary"
        for block in docs.cv.summary:
            yield "text", block.text
        if docs.cv.experience or docs.cv.work_history:
            yield "heading", "Experience"
            for entry in docs.cv.work_history:
                yield "subheading", entry.heading.text
                for block in entry.bullets:
                    yield "bullet", block.text
            for block in docs.cv.experience:
                yield "bullet", block.text
        for heading, entries in (("Projects", docs.cv.projects), ("Skills", docs.cv.skills),
                                 ("Education", docs.cv.education), ("Certifications", docs.cv.certifications)):
            if entries:
                yield "heading", heading
                if heading == "Skills":
                    yield "text", ", ".join(block.text for block in entries)
                else:
                    for block in entries:
                        yield "bullet", block.text
    elif kind == "letter":
        yield "title", details.name
        yield "subtitle", f"{run.job.details.role} | {run.job.details.company}"
        yield "text", "Dear Hiring Team,"
        for block in docs.letter:
            yield "text", block.text
        yield "text", "Kind regards,"
        yield "text", details.name
    else:
        yield "title", "Job fit"
        yield "subtitle", f"{run.job.details.role} | {run.job.details.company}"
        if run.baseline:
            comparison = score(run.baseline, docs.fit)
            yield "heading", "Before and after"
            yield "text", f"Estimated fit: {comparison['before']}/100 before · {comparison['after']}/100 after"
            for row in comparison["rows"]:
                if row["before"] is not None:
                    yield "text", f"{row['area']}: {row['before']} → {row['after']} of {row['max']} points"
        yield "heading", "Requirements"
        before = {normalize_requirement(item.requirement): item for item in run.baseline.items} if run.baseline else {}
        sources = {source.id: source.text for source in run.sources}
        status = {"supported": "Supported", "partial": "Partial", "unknown": "Not established"}
        for item in docs.fit:
            yield "subheading", item.requirement
            baseline = before.get(normalize_requirement(item.requirement))
            if baseline:
                yield "text", f"Before · {status[baseline.status]}: {baseline.explanation}"
            yield "text", f"{'After · ' if baseline else ''}{status[item.status]}: {item.explanation}"
            for key in item.source_ids:
                if key in sources:
                    yield "bullet", sources[key]


def escape_tex(text):
    special = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$", "&": r"\&",
               "#": r"\#", "_": r"\_", "%": r"\%", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    return "".join(special.get(char, char) for char in text)


def editable_source(run, kind, format):
    lines = list(document_lines(run, kind))
    if format == "md":
        marks = {"title": "# ", "heading": "## ", "subheading": "### ", "bullet": "- "}
        return "\n\n".join(marks.get(role, "") + re.sub(r"([\\`*_\[\]<>])", r"\\\1", text)
                           for role, text in lines) + "\n"
    if format == "typ":
        import json

        tags = {"title": "#heading(level: 1)[{}]", "heading": "#heading(level: 2)[{}]",
                "subheading": "#heading(level: 3)[{}]", "bullet": "- {}"}
        body = (tags.get(role, "{}").format("#text(" + json.dumps(text, ensure_ascii=False) + ")")
                for role, text in lines)
        return '#set page(paper: "a4", margin: 1.8cm)\n\n' + "\n\n".join(body) + "\n"
    tags = {"title": r"\section*{%s}", "heading": r"\subsection*{%s}",
            "subheading": r"\paragraph{%s}", "bullet": r"\noindent\textbullet\ %s"}
    body = (tags.get(role, "%s") % escape_tex(text) for role, text in lines)
    return "\n".join([r"\documentclass[a4paper,11pt]{article}", r"\usepackage[T1]{fontenc}",
                      r"\input{glyphtounicode}", r"\pdfgentounicode=1",
                      r"\begin{document}", "\n\n".join(body), r"\end{document}", ""])


def render_bundle(run, format):
    from .pdf import render_document

    buffer = BytesIO()
    with ZipFile(buffer, "w", ZIP_DEFLATED) as archive:
        for kind, basename in (("cv", "tailored-cv"), ("letter", "cover-letter"), ("fit", "job-fit")):
            extension = "md" if kind == "fit" and format in ("tex", "typ") else format
            content = render_document(run, kind) if extension == "pdf" else editable_source(run, kind, extension)
            archive.writestr(f"{basename}.{extension}", content)
    return buffer.getvalue()


def check_pdf_readiness(run):
    from .pdf import render_document, pdf_text

    reader = PdfReader(BytesIO(render_document(run, "cv")))
    extracted = "\n".join(page.extract_text() or "" for page in reader.pages)
    normalize = lambda value: " ".join(pdf_text(value).casefold().split())
    text = normalize(extracted)
    offset = 0
    ordered = True
    for _, source in document_lines(run, "cv"):
        expected = normalize(source)
        start = text.find(expected, offset)
        if start < 0:
            ordered = False
            break
        offset = start + len(expected)
    bullets = [content for role, content in document_lines(run, "cv") if role == "bullet"]
    warnings = []
    long_bullets = sum(len(bullet.split()) > 36 for bullet in bullets)
    passive = sum(bullet.casefold().startswith(("responsible for", "helped with", "worked on"))
                  for bullet in bullets)
    if long_bullets:
        warnings.append(f"{long_bullets} bullets exceed 36 words.")
    if passive:
        warnings.append(f"{passive} bullets could describe your contribution more directly.")
    keywords = run.job.details.skills
    matched = [phrase for phrase in keywords
               if re.search(r"(?<!\w)" + re.escape(normalize(phrase)) + r"(?!\w)", text)]
    sections = [content for role, content in document_lines(run, "cv") if role == "heading"]
    return {
        "pages": len(reader.pages),
        "warnings": warnings,
        "selectable_text": bool(text),
        "reading_order": ordered,
        "contact_present": bool(re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d .()-]{7,}\d", run.profile.details.contact)),
        "sections": sections,
        "missing_sections": [heading for heading in ("Summary", "Experience", "Skills") if heading not in sections],
        "matched_keywords": matched,
        "missing_keywords": [phrase for phrase in keywords if phrase not in matched],
    }

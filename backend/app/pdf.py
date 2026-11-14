"""Fixed single-column PDF templates. Content is escaped, never interpreted as markup."""
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from fastapi import HTTPException
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

FONT_DIR = Path(__file__).resolve().parents[1] / "fonts"
pdfmetrics.registerFont(TTFont("JobFather", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("JobFather-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))


def render_document(run, kind: str) -> bytes:
    stream = BytesIO()
    profile, documents = run.profile.details, run.documents
    body = ParagraphStyle("body", fontName="JobFather", fontSize=10, leading=15,
                          textColor=colors.HexColor("#202020"), spaceAfter=10, alignment=TA_LEFT)
    title = ParagraphStyle("name", parent=body, fontName="JobFather-Bold", fontSize=23, leading=29, spaceAfter=4)
    subtitle = ParagraphStyle("subtitle", parent=body, textColor=colors.HexColor("#595959"), spaceAfter=17)
    heading = ParagraphStyle("heading", parent=body, fontName="JobFather-Bold", fontSize=11,
                             leading=16, spaceBefore=12, spaceAfter=8, keepWithNext=True)
    bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, firstLineIndent=0, bulletIndent=0)

    def paragraph(text, style=body, **kwargs):
        # Keep genuine letters/accents; normalize nonstandard dashes and control characters.
        text = "".join(char for char in text if char.isprintable() or char == "\n")
        for dash in ("\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2212"):
            text = text.replace(dash, "-")
        face = pdfmetrics.getFont(style.fontName).face
        if any(ord(char) not in face.charWidths for char in text if not char.isspace()):
            raise HTTPException(422, "A character in this draft is not supported by the PDF font.")
        return Paragraph(escape(text).replace("\n", "<br/>"), style, **kwargs)

    story = [paragraph(profile.name, title)]
    if kind == "cv":
        if profile.role:
            story.append(paragraph(profile.role, subtitle))
        story.append(paragraph("Profile", heading))
        story.extend(paragraph(block.text) for block in documents.cv.summary)
        if documents.cv.experience:
            story.append(paragraph("Experience", heading))
            story.extend(paragraph(block.text, bullet, bulletText="•") for block in documents.cv.experience)
        if documents.cv.skills:
            story.append(paragraph("Skills", heading))
            story.append(paragraph(", ".join(block.text for block in documents.cv.skills)))
    else:
        story += [paragraph(f"{run.job.details.role} | {run.job.details.company}", subtitle),
                  Spacer(1, 10), paragraph("Dear Hiring Team,"), Spacer(1, 3)]
        story.extend(paragraph(block.text) for block in documents.letter)
        story += [Spacer(1, 8), paragraph("Kind regards,"), paragraph(profile.name)]

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("JobFather", 8)
        canvas.setFillColor(colors.HexColor("#666666"))
        canvas.drawRightString(A4[0] - 48, 30, str(doc.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(stream, pagesize=A4, leftMargin=48, rightMargin=48, topMargin=45, bottomMargin=48,
                            title=f"{profile.name} - {'CV' if kind == 'cv' else 'Cover letter'}", author=profile.name,
                            invariant=1)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return stream.getvalue()

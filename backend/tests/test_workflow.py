"""Workflow regressions using fictional evidence and provider responses."""
import json
import unittest
from io import BytesIO
from unittest.mock import patch
from zipfile import ZipFile

from pydantic import HttpUrl

from backend.app import application, fit, profile, session, sources

from test_application import documents
import test_application


class WorkflowTests(unittest.TestCase):
    setUp = test_application.ApplicationTests.setUp
    tearDown = test_application.ApplicationTests.tearDown
    state = test_application.ApplicationTests.state
    create = test_application.ApplicationTests.create

    def test_baseline_stays_pinned_and_compares_the_same_requirements(self):
        with patch.object(fit, "generate_json", return_value={"items": [
            {"requirement": "React", "pillar": "skills", "status": "partial",
             "explanation": "React forms appear in the resume.", "source_ids": ["experience-1"]},
            {"requirement": "Kubernetes", "pillar": "experience", "status": "unknown",
             "explanation": "No Kubernetes evidence.", "source_ids": []},
        ]}):
            baseline = self.client.post("/api/application/baseline?job_version=1")
        self.assertEqual(baseline.status_code, 200)
        original = profile.read_profile()
        original.resume_details = original.details.model_copy()
        profile.save_profile(original)
        updated = self.client.put("/api/profile/evidence", json={"version": 2, "evidence": {
            "kind": "linkedin", "label": "Reviewed profile", "text": "Built accessible React forms."}})
        updated.raise_for_status()
        self.assertEqual(self.client.get("/api/application/baseline?job_version=1").json(), baseline.json())

        output = documents().model_dump()
        output["cv"]["experience"].append({"text": "Built accessible React forms.", "source_ids": ["linkedin"]})
        with patch.object(application, "generate_json", side_effect=[output, {"safe": True}]):
            self.client.post("/api/application/generate", json={"job_version": 1, "profile_version": 3}).raise_for_status()
        state = self.state()
        self.assertIsNone(state["error"])
        self.assertGreater(state["comparison"]["after"], state["comparison"]["before"])
        self.assertEqual(state["current"]["baseline"]["resume_sources"]["experience-1"], "Built React forms at A & B.")

    def test_topic_skip_and_call_progress_resume_chat_on_the_current_prompt(self):
        next_topics = []

        def ask(_, parts, schema):
            topic = json.loads(parts[0]["text"])["next_topic"]
            next_topics.append(topic)
            return {"message": f"Tell me about {topic}.", "fact": "", "evidence": ""}

        job = {"job_version": 1}
        with patch.object(session, "generate_json", side_effect=ask):
            started = self.client.post("/api/session/start", json=job).json()
            skipped = self.client.post("/api/session/topics", json={
                **job, "revision": started["revision"], "topic": "Job requirements",
                "status": "skipped", "mode": "chat",
            }).json()
            self.assertEqual(skipped["topics"], {"Job requirements": "skipped"})
            call_progress = {
                **job, "revision": started["revision"], "topic": "Personal contribution",
                "status": "covered", "mode": "call",
            }
            advanced = self.client.post("/api/session/topics", json=call_progress)
            self.assertEqual(advanced.status_code, 200)
            self.assertEqual(self.client.post("/api/session/topics", json=call_progress).status_code, 409)
            self.assertEqual(self.client.post("/api/session/chat", json={
                **job, "revision": advanced.json()["revision"], "answer": "Old question",
            }).status_code, 409)
            resumed = self.client.post("/api/session/start", json=job).json()
            self.assertEqual(resumed["messages"][-1]["topic"], "Impact and scale")
            self.assertEqual(resumed["topics"]["Personal contribution"], "covered")
            self.assertEqual(self.client.post("/api/session/start", json=job).json(), resumed)
        self.assertEqual(next_topics, ["Job requirements", "Personal contribution", "Impact and scale"])

    def test_cv_revision_keeps_letter_and_exports_revision(self):
        first = self.create()
        response = documents().model_dump()
        response["cv"]["experience"][0]["text"] = "Built React forms."
        response["letter"][0]["text"] = "Invented candidate claim."
        with patch.object(application, "generate_json", side_effect=[response, {"safe": True}]):
            self.client.post("/api/application/revise", json={"job_version": 1, "profile_version": 1,
                "base_id": first["id"], "document": "cv", "instruction": "Tighten the bullet"}).raise_for_status()
        revised = self.state()["current"]
        self.assertEqual(revised["version"], 2)
        self.assertEqual(revised["documents"]["letter"], first["documents"]["letter"])
        path = f"/api/application/runs/{revised['id']}"
        ats = self.client.get(path + "/ats").json()
        self.assertTrue(ats["reading_order"])
        self.assertEqual(ats["matched_keywords"], ["React"])
        self.assertEqual(ats["missing_keywords"], ["Kubernetes"])
        for output, extension in [("pdf", "pdf"), ("md", "md"), ("tex", "tex"), ("typ", "typ")]:
            response = self.client.get(path + "/bundle.zip", params={"format": output})
            response.raise_for_status()
            with ZipFile(BytesIO(response.content)) as bundle:
                self.assertEqual(bundle.namelist(), [f"tailored-cv.{extension}", f"cover-letter.{extension}",
                    f"job-fit.{'pdf' if output == 'pdf' else 'md'}"])
                if output == "md":
                    self.assertIn(b"Built React forms.", bundle.read("tailored-cv.md"))

    def test_board_adapters_use_fixed_urls_and_structured_posting(self):
        with patch.object(sources, "public_json", return_value={"title": "Engineer", "content": "<p>Write tests</p>"}) as public:
            text = sources.board_posting(HttpUrl("https://job-boards.greenhouse.io/harbor/jobs/42"), max_length=500)
        self.assertIn("Write tests", text)
        public.assert_called_once_with("https://boards-api.greenhouse.io/v1/boards/harbor/jobs/42")
        with patch.object(sources, "public_json", return_value={
            "text": "Engineer", "descriptionPlain": "Design apps.", "lists": [{"text": "Must", "content": "<li>Python</li>"}]
        }):
            self.assertIn("Python", sources.board_posting(HttpUrl(
                "https://jobs.eu.lever.co/harbor/6d5beaf3-66ba-4c4d-b363-e138c9de0d65"), max_length=500))
        html = '<script type="application/ld+json">{"@graph":[{"@type":"JobPosting","title":"Engineer","description":"Build tools"}]}</script>'
        with patch.object(sources, "read_public_html", return_value=html):
            self.assertIn("Build tools", sources.structured_posting(HttpUrl("https://example.com/jobs/42"), max_length=500))

    def test_docx_import_keeps_original_and_linkedin_pdf_is_review_only(self):
        from backend.app import main
        from reportlab.pdfgen import canvas

        document = BytesIO()
        with ZipFile(document, "w") as package:
            package.writestr("word/document.xml", """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                <w:body><w:p><w:r><w:t>Alex Morgan built React forms.</w:t></w:r></w:p></w:body>
                </w:document>""")
        headers = {"X-Resume-Filename": "sample.docx", "X-Profile-Sources": '{"version":1}'}
        with patch.object(main, "extract_resume_text", return_value=profile.ProfileDetails(
            name="Alex Morgan", experience="Built React forms.")) as extractor:
            response = self.client.put("/api/profile/sources/docx", headers=headers, content=document.getvalue())
        response.raise_for_status()
        extractor.assert_called_once_with("Alex Morgan built React forms.")
        self.assertEqual(response.json()["resume"]["kind"], "docx")
        self.assertEqual(self.client.get("/api/profile/resume").content, document.getvalue())

        pdf = BytesIO()
        report = canvas.Canvas(pdf)
        report.drawString(50, 750, "Alex Morgan worked on accessible forms.")
        report.save()
        response = self.client.post("/api/profile/evidence/linkedin/pdf",
            headers={"X-Resume-Filename": "linkedin.pdf"}, content=pdf.getvalue())
        response.raise_for_status()
        self.assertIn("accessible forms", response.json()["text"])
        self.assertEqual(profile.read_profile().evidence, [])

    def test_github_preview_requires_explicit_approval(self):
        with patch.object(sources, "public_json", side_effect=[
            {"private": False, "description": "A library app"}, {"encoding": "base64", "content": "VGVzdA=="},
            {"Python": 500},
        ]):
            response = self.client.post("/api/profile/evidence/github", json={"url": "https://github.com/alex/library"})
        response.raise_for_status()
        self.assertEqual(response.json()["readme"], "Test")
        self.assertEqual(profile.read_profile().evidence, [])
        response = self.client.put("/api/profile/evidence", json={"version": 1, "evidence": {
            "kind": "github", "url": response.json()["url"], "label": "alex/library",
            "text": "I wrote the Python search route."}})
        response.raise_for_status()
        self.assertIn("I wrote the Python search route.",
                      [item.text for item in application.sources_for(profile.read_profile())])

"""Application invariants. All Gemini responses are mocked; no API key is needed."""
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pypdf import PdfReader

from backend.app import application, profile
from backend.app.gemini import GeminiError
from backend.app.main import app


def documents():
    claim = lambda text, source: {"text": text, "source_ids": [source]}
    return application.Documents.model_validate({
        "cv": {"summary": [claim("Software engineer.", "role-1")],
               "experience": [claim("Built React forms at A & B.", "experience-1")],
               "skills": [claim("React", "skills-1")]},
        "letter": [claim("I built React forms at A & B.", "experience-1"),
                   claim("I would like to bring my React experience to this role.", "skills-1")],
        "fit": [{"requirement": "React", "status": "supported", "explanation": "Built React forms.", "source_ids": ["experience-1"]},
                {"requirement": "Kubernetes", "status": "unknown", "explanation": "Not established in the saved profile.", "source_ids": []}],
    })


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(profile, "DB_PATH", Path(self.temp.name) / "test.sqlite3")
        self.patch.start()
        self.client = TestClient(app, base_url="http://127.0.0.1")
        self.client.__enter__()
        self.client.put("/api/profile", json={"version": 0, "details": {
            "name": "Alex Müller", "role": "Software engineer", "experience": "Built React forms at A & B.", "skills": "React"}}).raise_for_status()
        self.client.put("/api/job", json={"version": 0, "details": {
            "role": "Engineer", "company": "Harbor", "description": "React and Kubernetes", "skills": ["React", "Kubernetes"]}}).raise_for_status()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.patch.stop()
        self.temp.cleanup()

    def state(self):
        return self.client.get("/api/application?job_version=1").json()

    def create(self, base=None):
        with patch.object(application, "build_documents", return_value=documents()):
            result = self.client.post("/api/application/generate", json={
                "job_version": 1, "profile_version": 1, "base_id": base})
        self.assertEqual(result.status_code, 202)
        return self.state()["current"]

    def test_revision_history_and_restore_survive_failed_revision(self):
        first = self.create()
        response = documents().model_dump()
        response["cv"]["summary"][0]["text"] = "An unrequested CV change."
        with patch.object(application, "generate_json", side_effect=[response, {"safe": True}]):
            self.client.post("/api/application/revise", json={"job_version": 1, "profile_version": 1,
                "base_id": first["id"], "tone": "Direct", "instruction": "Make it shorter"}).raise_for_status()
        second = self.state()["current"]
        self.assertEqual(second["version"], 2)
        self.assertEqual(second["documents"]["cv"], first["documents"]["cv"])
        with patch.object(application, "generate_json", side_effect=GeminiError(429, "Try again later.")):
            self.client.post("/api/application/revise", json={"job_version": 1, "profile_version": 1,
                "base_id": second["id"], "instruction": "Make it shorter"}).raise_for_status()
        self.assertEqual(self.state()["current"]["id"], second["id"])
        result = self.client.post("/api/application/select", json={"job_version": 1,
            "base_id": second["id"], "selected_id": first["id"]})
        self.assertEqual(result.json()["current"]["id"], first["id"])
        self.assertEqual(len(result.json()["versions"]), 2)

    def test_deterministic_checks_block_invented_number_skill_and_source(self):
        run = application.Run.model_validate(self.create())
        for field, value in [("text", "Built 90 React forms."), ("source_ids", ["not-approved"])]:
            draft = documents()
            setattr(draft.cv.experience[0], field, value)
            with self.assertRaises(GeminiError):
                application.validate_documents(draft, run)
        draft = documents()
        draft.cv.skills[0].text = "Kubernetes"
        with self.assertRaises(GeminiError):
            application.validate_documents(draft, run)
        with patch.object(application, "generate_json", side_effect=[documents().model_dump(), {"safe": False}]):
            with self.assertRaises(GeminiError):
                application.build_documents(run, None)

    def test_profile_change_during_generation_preserves_previous(self):
        first = self.create()
        def change_profile(*_):
            current = profile.read_profile()
            current.details.experience += "\nNew approved work."
            profile.save_profile(current)
            return documents()
        with patch.object(application, "build_documents", side_effect=change_profile):
            self.client.post("/api/application/generate", json={"job_version": 1, "profile_version": 1,
                "base_id": first["id"]}).raise_for_status()
        self.assertEqual(self.state()["current"]["id"], first["id"])
        self.assertIn("changed", self.state()["error"])
        self.assertIsNone(self.state()["pending"])
        stale = self.client.post("/api/application/generate", json={"job_version": 1, "profile_version": 1,
            "base_id": first["id"]})
        self.assertEqual(stale.status_code, 409)

    def test_only_saved_profile_sources_used(self):
        from backend.app.session import Session, CapturedFact, write_session
        with profile.connect() as db:
            write_session(db, Session(job_version=1, facts=[CapturedFact(
                text="Led a Kubernetes team.", evidence="I led a Kubernetes team.")]))
        run = self.create()
        self.assertNotIn("Kubernetes", " ".join(source["text"] for source in run["sources"]))

    def test_pdf_is_deterministic_and_has_selectable_unicode_text(self):
        run = self.create()
        for kind in ("cv", "letter"):
            path = f"/api/application/runs/{run['id']}/{kind}.pdf"
            first = self.client.get(path)
            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.content, self.client.get(path).content)
            reader = PdfReader(BytesIO(first.content))
            text = "\n".join(page.extract_text() for page in reader.pages)
            self.assertIn("Alex Müller", text)
            self.assertIn("A & B", text)
            self.assertNotIn("source_ids", text)

    def test_pdf_wraps_long_text_and_keeps_all_pages(self):
        from backend.app.pdf import render_document
        run = application.Run.model_validate(self.create())
        text = "Built forms for A & B <internal> tools in München. " * 24
        run.documents.cv.experience = [application.Claim(text=text, source_ids=["experience-1"]) for _ in range(12)]
        reader = PdfReader(BytesIO(render_document(run, "cv")))
        self.assertGreater(len(reader.pages), 1)
        extracted = " ".join(page.extract_text() for page in reader.pages)
        self.assertEqual(extracted.count("<internal>"), 24 * 12)
        self.assertIn("München", extracted)


if __name__ == "__main__":
    unittest.main()

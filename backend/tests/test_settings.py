"""Key storage and request forwarding; all credentials and Gemini calls are fake."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from backend.app import gemini, main, profile, settings


class SettingsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        database = patch.object(profile, "DB_PATH", Path(temporary.name) / "test.sqlite3")
        database.start()
        self.addCleanup(database.stop)
        environment = patch.dict(os.environ, {"GEMINI_API_KEY": "test-environment-key-only"})
        environment.start()
        self.addCleanup(environment.stop)
        origins = patch.object(main, "APP_ORIGINS", {"http://localhost:3000"})
        origins.start()
        self.addCleanup(origins.stop)
        self.client = TestClient(main.app, base_url="http://localhost:3000",
                                 headers={"Origin": "http://localhost:3000"})
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def test_standard_and_authorization_keys_save_and_reach_gemini_unchanged(self):
        for key in ("AIza" + "a" * 35, "AQ." + "b" * 50):
            with self.subTest(key_type=key[:3]):
                result = self.client.put("/api/settings/gemini", json={"api_key": f" {key}\n"})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json(), {"source": "app"})
                self.assertEqual(self.client.get("/api/settings/gemini").json(), {"source": "app"})
                self.assertEqual(settings.key_file().read_text(), key)
                self.assertEqual(settings.key_file().stat().st_mode & 0o777, 0o600)
                response = httpx.Response(200, json={"candidates": [{
                    "finishReason": "STOP", "content": {"parts": [{"text": '{"ok": true}'}]}
                }]})
                with patch.object(gemini.httpx, "post", return_value=response) as request:
                    self.assertEqual(gemini.generate_json("Return JSON.", [], {"type": "object"}), {"ok": True})
                self.assertEqual(request.call_args.kwargs["headers"]["x-goog-api-key"], key)
        self.assertEqual(self.client.delete("/api/settings/gemini").json(), {"source": "environment"})
        self.assertEqual(settings.gemini_api_key(), "test-environment-key-only")

    def test_invalid_input_is_not_echoed_and_does_not_replace_saved_key(self):
        key = "test-existing-key-only"
        self.client.put("/api/settings/gemini", json={"api_key": key}).raise_for_status()
        invalid_keys = ["", "short", "GEMINI_API_KEY=" + key, f'"{key}"',
                        "test-key\r\nInjected-header", "test-key-with space", "x" * 257,
                        "test-key-with-unicode-\u00e9"]
        for value in invalid_keys:
            with self.subTest(value=value):
                result = self.client.put("/api/settings/gemini", json={"api_key": value})
                self.assertEqual(result.status_code, 422)
                self.assertEqual(result.json(), {"detail": "Enter a Gemini API key."})
                self.assertEqual(settings.saved_key(), key)


if __name__ == "__main__":
    unittest.main()

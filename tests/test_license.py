import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class LicensingTests(unittest.TestCase):
    def test_root_license_and_spdx_metadata(self):
        license_text = (ROOT / "LICENSE").read_text(encoding="utf-8")
        self.assertTrue(license_text.startswith("MIT License\n"))
        self.assertIn("Copyright (c) 2026 GoreeCloud", license_text)
        self.assertIn("Permission is hereby granted", license_text)
        self.assertIn("THE SOFTWARE IS PROVIDED", license_text)
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["license"], "MIT")

    def test_goreecloud_ui_attribution_and_scope(self):
        notice = (ROOT / "NOTICE.md").read_text(encoding="utf-8")
        self.assertIn("app/gc-tokens.css", notice)
        self.assertIn("https://github.com/GoreeCloud/gc-ui", notice)
        self.assertIn("MIT", notice)
        self.assertIn("**not** bundled", notice)
        self.assertIn("MIT", (ROOT / "README.md").read_text(encoding="utf-8"))

if __name__ == "__main__":
    unittest.main()

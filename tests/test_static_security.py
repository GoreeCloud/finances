"""Static security and accessibility guardrails for the disconnected prototype."""
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / 'app'


class InterfaceParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.elements = []

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


class StaticBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (APP / 'index.html').read_text()
        cls.javascript = '\n'.join((APP / file).read_text() for file in ('main.js', 'finance.js'))
        cls.parser = InterfaceParser()
        cls.parser.feed(cls.html)

    def test_no_external_assets_or_inline_scripts(self):
        assets = [(tag, attrs) for tag, attrs in self.parser.elements
                  if tag in ('script', 'link', 'iframe', 'img')]
        self.assertTrue(assets)
        for _, attrs in assets:
            src = attrs.get('src', attrs.get('href', ''))
            self.assertFalse(src.startswith(('https:', 'http:', '//', 'data:', 'javascript:')), src)
        self.assertNotIn('<script>', self.html)
        self.assertNotIn('onerror=', self.html)

    def test_csp_fails_closed(self):
        self.assertIn("default-src 'none'", self.html)
        self.assertIn("connect-src 'none'", self.html)
        self.assertIn("script-src 'self'", self.html)
        self.assertIn("form-action 'none'", self.html)

    def test_no_outbound_or_persistent_storage_apis(self):
        for forbidden in (r'\bfetch\s*\(', r'\bXMLHttpRequest\b', r'\blocalStorage\.',
                          r'\bsessionStorage\.', r'\bnavigator\.sendBeacon\b',
                          r'\bindexedDB\.', r'\bWebSocket\s*\('):
            self.assertNotRegex(self.javascript, forbidden)

    def test_unique_ids_and_form_labels(self):
        ids = [attrs['id'] for _, attrs in self.parser.elements if 'id' in attrs]
        self.assertEqual(len(ids), len(set(ids)))
        for tag, attrs in self.parser.elements:
            if tag == 'label' and 'for' in attrs:
                self.assertIn(attrs['for'], ids)

    def test_verified_gc_ui_token_subset_reference(self):
        tokens = (APP / 'gc-tokens.css').read_text()
        self.assertIn('--gc-canvas:#0D121D', tokens)
        self.assertIn('--gc-brand:#8BE7F1', tokens)
        self.assertIn('GoreeCloud/gc-ui', tokens)


if __name__ == '__main__':
    unittest.main()

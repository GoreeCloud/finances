"""Static accessibility and privacy gates for the full stored-history UI.

Not a substitute for browser, screen-reader or assisted-device testing.
"""
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

class Dom(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.labels = set()
        self.headers = []
        self.links = []
        self.scripts = []
        self.statuses = set()
        self.buttons = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id'):
            if attrs['id'] in self.ids:
                raise AssertionError('duplicate ID ' + attrs['id'])
            self.ids.add(attrs['id'])
        if tag == 'label' and attrs.get('for'):
            self.labels.add(attrs['for'])
        if tag == 'th':
            self.headers.append(attrs.get('scope'))
        if tag == 'script':
            self.scripts.append(attrs.get('src'))
        if tag == 'link':
            self.links.append(attrs.get('href'))
        if attrs.get('role') == 'status' and attrs.get('id'):
            self.statuses.add(attrs['id'])
        if tag == 'button' and attrs.get('id'):
            self.buttons.add(attrs['id'])

class DashboardHistoryQuality(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / 'web/index.html').read_text(encoding='utf-8')
        cls.client = (ROOT / 'web/app.js').read_text(encoding='utf-8')
        cls.dom = Dom()
        cls.dom.feed(cls.html)

    def test_all_filter_controls_have_accessible_explicit_labels(self):
        filters = {'query', 'tx-institution', 'tx-source', 'tx-start', 'tx-end'}
        self.assertTrue(filters <= self.dom.ids)
        self.assertTrue(filters <= self.dom.labels)
        self.assertIn('clear-tx-filters', self.dom.buttons)
        self.assertIn('load-more', self.dom.buttons)

    def test_table_has_explicit_headers_and_results_status(self):
        self.assertIn('entries', self.dom.ids)
        self.assertTrue(self.dom.headers)
        self.assertTrue(all(scope == 'col' for scope in self.dom.headers))
        self.assertIn('transaction-status', self.dom.statuses)
        self.assertIn('no-entries', self.dom.ids)
        self.assertIn('id="load-more"', self.html)

    def test_ui_keeps_library_loading_opt_in_and_local_code(self):
        self.assertEqual(self.dom.scripts, ['/app.js'])
        self.assertEqual(self.dom.links, ['/tokens.css', '/style.css'])
        self.assertIn('https://cdn.plaid.com/link/v2/stable/link-initialize.js', self.client)
        self.assertIn('beginLink(', self.client)
        self.assertNotIn('localStorage', self.client)
        self.assertNotIn('sessionStorage', self.client)
        self.assertNotIn('indexedDB', self.client)
        self.assertIn("api('transactions'", self.client)
        self.assertIn('searchEpoch', self.client)

if __name__ == '__main__':
    unittest.main()

"""Optional isolated Chromium browser regression suite. Synthetic statements only."""
import contextlib
import http.server
import socketserver
import tempfile
import threading
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parents[1] / 'app'


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP), **kwargs)

    def log_message(self, *args):
        pass


class BrowserSmoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), Handler)
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}/index.html'
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                             args=['--no-sandbox'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 1240, 'height': 850})
        self.errors = []
        self.requests = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.on('request', lambda request: self.requests.append(request.url))
        self.page.goto(self.url)

    def tearDown(self):
        self.page.close()

    def upload(self, name='synthetic.csv', content=None):
        if content is None:
            content = 'date,description,amount\n2026-11-01,"Store, Inc.",-0.30\n2026-11-02,Salary,1.25\n'
        self.page.locator('#statement').set_input_files({'name': name, 'mimeType': 'text/csv',
                                                           'buffer': content.encode()})
        self.page.locator('#analyze').click()

    def test_institutions_and_no_external_requests(self):
        self.assertEqual(self.page.locator('#institutions .institution').count(), 7)
        self.assertEqual(self.page.locator('#metric-count').inner_text(), '0')
        self.assertEqual(self.page.locator('#metric-net').inner_text(), '$0.00')
        self.assertTrue(all(x.startswith(self.url.rsplit('/', 1)[0]) for x in self.requests), self.requests)
        self.assertEqual(self.errors, [])

    def test_import_filter_mask_clear(self):
        self.page.locator('#institution').select_option('PayPal')
        self.upload()
        self.assertIn('2 new rows imported', self.page.locator('#result').inner_text())
        self.assertEqual(self.page.locator('#metric-net').inner_text(), '$0.95')
        self.assertEqual(self.page.locator('#metric-out').inner_text(), '$0.30')
        self.assertEqual(self.page.locator('#transactions tr').count(), 2)
        self.page.locator('#search').fill('Store')
        self.assertEqual(self.page.locator('#metric-net').inner_text(), '-$0.30')
        self.page.locator('#mask').check()
        self.assertNotIn('$0.30', self.page.locator('#metric-net').inner_text())
        self.page.locator('#clear').click()
        self.assertEqual(self.page.locator('#metric-count').inner_text(), '0')
        self.assertEqual(self.page.locator('#transactions tr').count(), 0)
        self.assertEqual(self.errors, [])

    def test_reimport_idempotency_and_invalid_file_atomicity(self):
        self.upload()
        self.upload()
        self.assertIn('0 new rows imported; 2 exact-match rows skipped', self.page.locator('#result').inner_text())
        self.assertEqual(self.page.locator('#metric-count').inner_text(), '2')
        self.upload(content='date,description,amount\n2026-02-29,Invalid,4.00\n')
        self.assertIn('Import rejected', self.page.locator('#result').inner_text())
        self.assertEqual(self.page.locator('#metric-count').inner_text(), '2')
        self.assertEqual(self.errors, [])

    def test_markup_is_displayed_as_text(self):
        self.upload(content='date,description,amount\n2026-11-01,"<img src=x onerror=alert(1)>",-1.00\n')
        self.assertEqual(self.page.locator('#transactions img').count(), 0)
        self.assertIn('<img', self.page.locator('#transactions').inner_text())
        self.assertEqual(self.errors, [])

    def test_invalid_utf8_and_no_storage(self):
        self.page.locator('#statement').set_input_files({'name': 'bad.csv', 'mimeType': 'text/csv',
                                                           'buffer': b'date,description,amount\n2026-11-01,\xff,1.00\n'})
        self.page.locator('#analyze').click()
        self.assertIn('Import rejected', self.page.locator('#result').inner_text())
        self.assertEqual(self.page.evaluate('localStorage.length'), 0)
        self.assertEqual(self.page.evaluate('sessionStorage.length'), 0)
        self.assertEqual(self.errors, [])

    def test_mobile_layout_and_screenshot(self):
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > window.innerWidth'))
        self.assertTrue(self.page.locator('#statement').is_visible())
        outfile = Path(tempfile.gettempdir()) / 'gc-finance-mobile-smoke.png'
        self.page.screenshot(path=str(outfile), full_page=True)
        self.assertGreater(outfile.stat().st_size, 3000)
        self.assertEqual(self.errors, [])


if __name__ == '__main__':
    unittest.main()

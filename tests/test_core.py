import unittest
from decimal import Decimal
from app.core import parse_csv, summary, INSTITUTIONS


class CoreTests(unittest.TestCase):
    def test_all_institutions(self):
        self.assertEqual(len(INSTITUTIONS), 7)

    def test_valid(self):
        rows = parse_csv(b'date,description,amount\n2026-11-01,Deposit,12.50\n2026-11-02,Food,-3.20\n', 'PayPal')
        self.assertEqual(summary(rows), {'count': 2, 'inflow': '12.50', 'outflow': '3.20', 'net': '9.30'})

    def test_quoted_fields(self):
        rows = parse_csv(b'date,description,amount\r\n2026-11-02,"A, B ""Vendor""",-1.20\r\n', 'Varo')
        self.assertEqual(rows[0].description, 'A, B "Vendor"')

    def test_preserves_two_equal_rows(self):
        source = b'date,description,amount\n2026-11-02,Store,-1.20\n2026-11-02,Store,-1.20\n'
        self.assertEqual(len(parse_csv(source, 'Discover')), 2)

    def test_reject_unknown(self):
        with self.assertRaises(ValueError):
            parse_csv(b'date,description,amount\n', 'Unknown')

    def test_reject_nan_and_exponent(self):
        for amount in ('NaN', 'Inf', '1E+3', '1.234', '1,234'):
            with self.subTest(amount=amount), self.assertRaises(ValueError):
                parse_csv(f'date,description,amount\n2026-11-01,Test,{amount}\n'.encode(), 'Varo')

    def test_reject_extra_column(self):
        with self.assertRaises(ValueError):
            parse_csv(b'date,description,amount,secret\n', 'Discover')

    def test_reject_huge(self):
        with self.assertRaises(ValueError):
            parse_csv(b'x' * 2_000_001, 'Discover')

    def test_reject_invalid_dates(self):
        for value in ('2026-02-29', '2026-11-31', '20261101', '1899-01-01'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_csv(f'date,description,amount\n{value},Test,1\n'.encode(), 'PayPal')

    def test_reject_malformed_quote(self):
        with self.assertRaises(ValueError):
            parse_csv(b'date,description,amount\n2026-11-01,"unfinished,1\n', 'Varo')

    def test_reject_null_byte(self):
        with self.assertRaises(ValueError):
            parse_csv(b'date,description,amount\n2026-11-01,Bad\0,1\n', 'PayPal')

    def test_reject_invalid_utf8(self):
        with self.assertRaises(ValueError):
            parse_csv(b'date,description,amount\n\xff,food,1\n', 'PayPal')

    def test_amount_boundary(self):
        rows = parse_csv(b'date,description,amount\n2026-11-01,Max,1000000000.00\n', 'PayPal')
        self.assertEqual(rows[0].amount, Decimal('1000000000.00'))
        with self.assertRaises(ValueError):
            parse_csv(b'date,description,amount\n2026-11-01,Over,1000000000.01\n', 'PayPal')


if __name__ == '__main__':
    unittest.main()

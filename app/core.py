"""Offline, read-only financial statement model. No network, bank credentials or payment operations."""
import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation

INSTITUTIONS = (
    'Navy Federal Credit Union', 'Cash App', 'Varo', 'Capital One',
    'Marcus by Goldman Sachs', 'Discover', 'PayPal'
)
MAX_IMPORT_BYTES = 2_000_000
MAX_ROWS = 10_000
DATE_RE = re.compile(r'\d{4}-\d{2}-\d{2}\Z')
AMOUNT_RE = re.compile(r'-?(?:0|[1-9]\d*)(?:\.\d{1,2})?\Z')


@dataclass(frozen=True)
class Transaction:
    institution: str
    date: date
    description: str
    amount: Decimal


def parse_csv(content: bytes, institution: str) -> list[Transaction]:
    if institution not in INSTITUTIONS:
        raise ValueError('Unknown institution')
    if len(content) > MAX_IMPORT_BYTES:
        raise ValueError('File exceeds 2 MB')
    try:
        decoded = content.decode('utf-8-sig', errors='strict')
        if '\0' in decoded:
            raise ValueError('NUL bytes are not allowed')
        reader = csv.reader(io.StringIO(decoded, newline=''), strict=True)
        if next(reader, None) != ['date', 'description', 'amount']:
            raise ValueError('Expected columns exactly: date,description,amount')
        rows = []
        for line_no, row in enumerate(reader, start=2):
            if len(rows) >= MAX_ROWS:
                raise ValueError('Too many rows')
            if len(row) != 3:
                raise ValueError(f'Row {line_no}: expected three fields')
            raw_date, raw_description, raw_amount = row
            if not DATE_RE.fullmatch(raw_date):
                raise ValueError(f'Row {line_no}: invalid ISO calendar date')
            try:
                parsed_date = date.fromisoformat(raw_date)
            except ValueError as exc:
                raise ValueError(f'Row {line_no}: invalid ISO calendar date') from exc
            if not (1900 <= parsed_date.year <= 2100):
                raise ValueError(f'Row {line_no}: date out of supported range')
            description = raw_description.strip()
            if not description or len(description) > 300 or any(
                (ord(c) < 32 and c not in '\n\r\t') or ord(c) == 127 for c in description
            ):
                raise ValueError(f'Row {line_no}: invalid description')
            if not AMOUNT_RE.fullmatch(raw_amount):
                raise ValueError(f'Row {line_no}: invalid amount format')
            try:
                amount = Decimal(raw_amount)
            except InvalidOperation as exc:
                raise ValueError(f'Row {line_no}: invalid amount') from exc
            if not amount.is_finite() or abs(amount) > Decimal('1000000000'):
                raise ValueError(f'Row {line_no}: amount out of range')
            rows.append(Transaction(institution, parsed_date, description, amount))
        return rows
    except (UnicodeDecodeError, csv.Error) as exc:
        raise ValueError('Invalid UTF-8 CSV statement') from exc


def summary(rows: list[Transaction]) -> dict[str, str | int]:
    inflow = sum((tx.amount for tx in rows if tx.amount > 0), Decimal(0))
    outflow = sum((-tx.amount for tx in rows if tx.amount < 0), Decimal(0))
    return {'count': len(rows), 'inflow': str(inflow), 'outflow': str(outflow), 'net': str(inflow - outflow)}

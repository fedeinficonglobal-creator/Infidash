import json
import sqlite3
import sys
from pathlib import Path
from tempfile import gettempdir


if len(sys.argv) != 2:
    raise SystemExit("Usage: python scripts/create-test-sqlite-fixture.py <isolated-temp-file>")

target = Path(sys.argv[1]).resolve()
temp_root = Path(gettempdir()).resolve()
if temp_root not in target.parents or not target.parent.name.startswith("infidash-api-test-"):
    raise SystemExit("Refusing to create fixture outside an Infidash API-test temp directory")
if target.name != "legacy-fixture.sqlite" or target.exists():
    raise SystemExit("Refusing to overwrite a file or create a non-fixture path")

fixture_path = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "legacy-sqlite.json"
fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
target.parent.mkdir(parents=True, exist_ok=True)

with sqlite3.connect(target) as connection:
    for table, rows in fixture.items():
        if not rows:
            continue
        columns = list(rows[0])
        quoted_columns = ", ".join(f'"{column}" TEXT' for column in columns)
        names = ", ".join(f'"{column}"' for column in columns)
        placeholders = ", ".join("?" for _ in columns)
        connection.execute(f'CREATE TABLE "{table}" ({quoted_columns})')
        connection.executemany(
            f'INSERT INTO "{table}" ({names}) VALUES ({placeholders})',
            [[row.get(column) for column in columns] for row in rows],
        )

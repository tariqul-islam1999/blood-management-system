"""Offline PostgreSQL syntax validation for the admin-creation migration.

Parses the whole file with pglast (libpg_query, PostgreSQL grammar) and reports
every statement. Read-only: no database connection is made.

Run from the repository root:
    python scripts/validate-admin-creation-sql.py
"""

import sys
from pathlib import Path

import pglast
from pglast import parser

MIGRATION = Path("supabase/migrations/20261125000100_admin_creation.sql")


def main() -> int:
    if not MIGRATION.exists():
        print(f"MISSING: {MIGRATION}")
        return 2

    sql = MIGRATION.read_text(encoding="utf-8")

    # Split so each statement can be reported individually; parse() already
    # raises on the first syntax error, which is the behaviour we want.
    try:
        statements = pglast.parse_sql(sql)
    except Exception as error:  # noqa: BLE001 - report the parser message verbatim
        print("PARSE FAILED")
        print(error)
        return 1

    print(f"pglast version : {pglast.__version__}")
    print(f"libpg_query PG : {pglast.get_postgresql_version()}")
    print(f"statements     : {len(statements)}")

    function_bodies = 0
    for index, statement in enumerate(statements, start=1):
        kind = type(statement.stmt).__name__
        if kind == "CreateFunctionStmt":
            function_bodies += 1
        if kind in {"CreateFunctionStmt", "CreateStmt", "AlterTableStmt", "DoStmt",
                    "IndexStmt", "GrantStmt", "AlterFunctionStmt", "CommentStmt",
                    "DropStmt"}:
            print(f"  {index:>3}. {kind}")

    print(f"function bodies parsed: {function_bodies}")

    # PL/pgSQL bodies are not compiled by the parser (that needs a live server),
    # so report the count of dollar-quoted bodies for cross-checking.
    bodies = sql.count("AS $")
    print(f"dollar-quoted function bodies in source: {bodies}")

    if function_bodies != 6:
        print(f"WARNING: expected 6 functions (5 RPCs + 1 helper), parser saw {function_bodies}")
        return 3

    print("OK: no SQL syntax errors")

    # Structural checks on the PL/pgSQL bodies. pglast does not compile these
    # (that requires a live server), so verify the block structure textually.
    problems = []
    import re
    for tag in re.findall(r"AS \$(\w+)\$", sql):
        start = sql.index(f"AS ${tag}$")
        end = sql.index(f"${tag}$;", start)
        body = sql[start:end]
        begins = len(re.findall(r"(?m)^\s*BEGIN\s*$", body))
        ends = len(re.findall(r"(?m)^\s*END;\s*$", body))
        if begins != 1 or ends != 1:
            problems.append(f"{tag}: BEGIN={begins} END;={ends}")
        if "min(" in body and "uuid" in body.lower():
            problems.append(f"{tag}: suspicious min(uuid)")

    if problems:
        print("BODY STRUCTURE PROBLEMS:")
        for problem in problems:
            print("  " + problem)
        return 4

    print("OK: all 6 function bodies have balanced BEGIN/END; no min(uuid)")
    return 0

if __name__ == "__main__":
    sys.exit(main())

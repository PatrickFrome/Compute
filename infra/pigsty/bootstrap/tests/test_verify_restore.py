import ast
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "04-verify-restore.py"


class VerifyRestoreQueryTests(unittest.TestCase):
    def load_query(self, *, returncode=0, stdout="7\n", timeout=False):
        calls = []

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            if timeout:
                raise subprocess.TimeoutExpired(argv, kwargs.get("timeout", 0))
            return SimpleNamespace(returncode=returncode, stdout=stdout)

        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "q")
        namespace = {"conninfo": "host=private-fixture.invalid dbname=offline", "subprocess": SimpleNamespace(run=run, TimeoutExpired=subprocess.TimeoutExpired)}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), "exec"), namespace)
        return namespace["q"], calls

    def test_identifiers_use_psql_preprocessed_input_instead_of_raw_c_option(self):
        query, calls = self.load_query()
        sql = 'select count(*) from :"schema".:"name"'
        self.assertEqual(query(sql, {"schema": 'quoted"schema', "name": "name'; DROP TABLE x;--"}), "7")
        argv, kwargs = calls[0]
        self.assertNotIn("-c", argv)
        self.assertEqual(argv[-2:], ["-f", "-"])
        self.assertEqual(kwargs["input"].strip(), sql)
        self.assertIn('schema=quoted"schema', argv)
        self.assertIn("name=name'; DROP TABLE x;--", argv)
        self.assertNotIn("DROP", kwargs["input"])

    def test_query_failure_is_not_a_matching_count(self):
        query, _ = self.load_query(returncode=3)
        self.assertIsNone(query("select 1"))

    def test_query_is_bounded_and_timeout_fails_closed(self):
        query, calls = self.load_query(timeout=True)
        self.assertIsNone(query("select 1"))
        self.assertEqual(calls[0][1]["timeout"], 30)


if __name__ == "__main__":
    unittest.main()

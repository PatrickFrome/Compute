from __future__ import annotations

import ast
from pathlib import Path
import unittest


SOURCE = Path("worker/native_linux/h1_h13_prereq_probe.py")


class PreUnshareIdentityRegressionTest(unittest.TestCase):
    def test_uid_gid_are_captured_before_clone_newuser(self) -> None:
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
        function = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "_namespace_canary"
        )

        capture_line: int | None = None
        unshare_line: int | None = None
        for node in ast.walk(function):
            if isinstance(node, ast.Assign):
                names = {
                    elt.id
                    for target in node.targets
                    if isinstance(target, (ast.Tuple, ast.List))
                    for elt in target.elts
                    if isinstance(elt, ast.Name)
                }
                if {"uid", "gid"}.issubset(names):
                    call = node.value
                    if (
                        isinstance(call, ast.Tuple)
                        and len(call.elts) == 2
                        and all(isinstance(x, ast.Call) for x in call.elts)
                    ):
                        attrs = {
                            x.func.attr
                            for x in call.elts
                            if isinstance(x.func, ast.Attribute)
                        }
                        if attrs == {"getuid", "getgid"}:
                            capture_line = node.lineno
            if isinstance(node, ast.Call):
                text = ast.unparse(node)
                if "unshare" in text and "CLONE_NEWUSER" in text:
                    unshare_line = node.lineno if unshare_line is None else min(unshare_line, node.lineno)

        self.assertIsNotNone(capture_line, "uid/gid parent identity capture missing")
        self.assertIsNotNone(unshare_line, "CLONE_NEWUSER unshare missing")
        self.assertLess(
            capture_line,
            unshare_line,
            "uid/gid must be captured in the parent user namespace before CLONE_NEWUSER; "
            "capturing after unshare can observe overflow UID/GID and generate an invalid uid_map",
        )


if __name__ == "__main__":
    unittest.main()

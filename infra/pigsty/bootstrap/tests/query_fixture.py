"""Run the production query helper only, without the manifest CLI's top level."""
import ast
from pathlib import Path
import subprocess
import sys

source = Path(__file__).resolve().parents[1] / "04-verify-restore.py"
tree = ast.parse(source.read_text(encoding="utf-8"))
function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "q")
namespace = {"subprocess": subprocess, "conninfo": sys.argv[1]}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
assert namespace["q"]('select count(*) from :"schema".:"name"', {"schema": 'quoted"schema', "name": 'quoted"table'}) == "7"
print("quoted_identifier_count=7")

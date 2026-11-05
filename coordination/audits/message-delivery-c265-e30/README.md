# METAENGINE c265→e30 message delivery and ACK source-only fix

Read `AUDIT.md`. `production-delivery-gate.patch` is the full patch **against exact verified Git tree** `90fa5633d7926dd71a7303266073e0625325e740`.

`verify_zip_git_tree.py` independently computes the Git tree directly from ZIP entries (no Git/index). Its default ZIP path in the submitted script is local to this executor and may require updating to your source file path. Preserve Unicode filenames and executable modes from ZIP when extracting; this environment's stock `unzip` mangles some Unicode filenames.

Source-only: the tests use actual runtime/Edge handler modules and an inert RPC fixture with disposable local SQLite journal, not PostgreSQL, physical ChatGPT send, or native services. Never interpret an ACK as processing authority. Never merge unqualified code.

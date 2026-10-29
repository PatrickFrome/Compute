# Real PostgreSQL 17 seed-admission qualification

2026-10-29. Local PostgreSQL17.11 Debian binaries were verified byte-for-byte
against the official Debian download checksums before extraction to the test
workspace. No system package installation or existing database was changed.

- Server SHA256 d2ce1ddffafa783f9acda4c92c86fc21e8288bff3782d739294f14fa797d7886
  https://packages.debian.org/trixie/amd64/postgresql-17/download
- Client SHA256 9d8558f8dd57c8e92e218a20698383575d53742ca3f9e7c2b7fe5f246d5216ae
  https://packages.debian.org/trixie/amd64/postgresql-client-17/download

Initial test startup failed because the Debian default socket directory
/var/run/postgresql does not exist. The fixture already connects exclusively to
127.0.0.1 on a dynamically selected test port. Its disposable config now explicitly
sets unix_socket_directories to empty, avoiding dependency on a system directory.
This is documented PostgreSQL TCP-only operation, not qualification or replacement
of the application's Unix IPC transports; those tests remain failed here.
https://www.postgresql.org/docs/17/runtime-config-connection.html

The complete initial seed integration suite passes17/17, including a new actual
PostgreSQL cancellation negative: cancellation during physical observation leaves
zero seeds, projects, tasks and permits; readonly recovery proves pre-dispatch
rejection. Existing concurrency, rollback, device grant, lostCOMMITACK, UUID/body
collision and80-agent logical-roster tests also pass. Generated Windows identities,
ACLs and sandbox receipts remain explicit fixtures. No model was called.

Evidence: chat-cli-evidence/pg17-native-seed-cancel.log, disposable receipt path
printed in that log. The generated cluster was stopped and its postmaster PID file
is absent. This does not prove installed Windows execution or chat-agent pickup.

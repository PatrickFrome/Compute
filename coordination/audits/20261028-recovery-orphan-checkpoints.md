# Recovery restart rejects incomplete checkpoint sets and foreign receipt schemas

Startup previously scanned only archive files. A retained fleet-applied or
committed checkpoint with its archive missing was therefore ignored as an
empty journal. Startup also checked receipt identity/state/digest but did not
check the receipt schema domain.

Three regressions reproduced these cases. Startup now rejects recognized
orphan checkpoints and requires the exact v1 committed receipt schema. The
existing initialization catch retains the fence; the main integration now
propagates it to the current native Supervisor. No unknown artifact is removed
and no historical effect is retried. A genuine completed checkpoint remains
readable, explicitly covered by the receipt-domain regression.

Combined recovery and actual main-lifetime tests:104tests102pass0fail2Windows
kernel skips on Linux. Final aggregate and Windows qualification are separate;
these new changes have not been tested in an installed Windows client.

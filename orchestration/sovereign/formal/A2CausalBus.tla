---- MODULE A2CausalBus ----
EXTENDS Naturals, FiniteSets

CONSTANT MaxSeq

VARIABLES head, received, applied, mandatory, proofSeen,
          acceptedFresh, authorityEffect, mode

vars == <<head, received, applied, mandatory, proofSeen,
          acceptedFresh, authorityEffect, mode>>

Init ==
  /\ head = 0
  /\ received = 0
  /\ applied = 0
  /\ mandatory = {}
  /\ proofSeen = 0
  /\ acceptedFresh = FALSE
  /\ authorityEffect = FALSE
  /\ mode = "COLLABORATE"

CommitP0P1 ==
  /\ head < MaxSeq
  /\ head' = head + 1
  /\ mandatory' = mandatory \cup {head + 1}
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<received, applied, proofSeen, authorityEffect, mode>>

CommitP2P3 ==
  /\ head < MaxSeq
  /\ head' = head + 1
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<received, applied, mandatory, proofSeen, authorityEffect, mode>>

Receive ==
  /\ received < head
  /\ received' = head
  /\ UNCHANGED <<head, applied, mandatory, proofSeen, acceptedFresh, authorityEffect, mode>>

Apply ==
  /\ applied < received
  /\ applied' = received
  /\ UNCHANGED <<head, received, mandatory, proofSeen, acceptedFresh, authorityEffect, mode>>

SealVisibility ==
  /\ applied = received
  /\ proofSeen' = applied
  /\ mandatory' = {sequence \in mandatory : sequence > applied}
  /\ UNCHANGED <<head, received, applied, acceptedFresh, authorityEffect, mode>>

AcceptModelStep ==
  /\ mode = "COLLABORATE"
  /\ mandatory = {}
  /\ proofSeen <= applied
  /\ acceptedFresh' = TRUE
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, authorityEffect, mode>>

OpenDuel ==
  /\ mode = "COLLABORATE"
  /\ mode' = "DUEL"
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, authorityEffect>>

ResolveDuel ==
  /\ mode = "DUEL"
  /\ mode' = "COLLABORATE"
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, acceptedFresh, authorityEffect>>

Disconnect == UNCHANGED vars

Next == CommitP0P1 \/ CommitP2P3 \/ Receive \/ Apply \/
        SealVisibility \/ AcceptModelStep \/ OpenDuel \/ ResolveDuel \/ Disconnect

CursorOrder == proofSeen <= applied /\ applied <= received /\ received <= head
MandatoryBounded == mandatory \subseteq (1..head)
AcceptanceFresh == acceptedFresh => mandatory = {}
AcceptanceModeSafe == acceptedFresh => mode = "COLLABORATE"
AuthorityIsolation == authorityEffect = FALSE
ModeValid == mode \in {"COLLABORATE", "DUEL"}

====

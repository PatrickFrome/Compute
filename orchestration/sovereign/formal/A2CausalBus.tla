---- MODULE A2CausalBus ----
EXTENDS Naturals, FiniteSets

CONSTANT MaxSeq

VARIABLES head, received, applied, mandatory, proofSeen,
          acceptedFresh, authorityEffect, mode, roundStatus,
          roundBase, roundSeq, gptSubmitted, glmSubmitted

vars == <<head, received, applied, mandatory, proofSeen,
          acceptedFresh, authorityEffect, mode, roundStatus,
          roundBase, roundSeq, gptSubmitted, glmSubmitted>>

Init ==
  /\ head = 0
  /\ received = 0
  /\ applied = 0
  /\ mandatory = {}
  /\ proofSeen = 0
  /\ acceptedFresh = FALSE
  /\ authorityEffect = FALSE
  /\ mode = "COLLABORATE"
  /\ roundStatus = "IDLE"
  /\ roundBase = 0
  /\ roundSeq = 0
  /\ gptSubmitted = FALSE
  /\ glmSubmitted = FALSE

CommitP0P1 ==
  /\ head < MaxSeq
  /\ head' = head + 1
  /\ mandatory' = mandatory \cup {head + 1}
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<received, applied, proofSeen, authorityEffect, mode, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

CommitP2P3 ==
  /\ head < MaxSeq
  /\ head' = head + 1
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<received, applied, mandatory, proofSeen, authorityEffect, mode, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

Receive ==
  /\ received < head
  /\ received' = head
  /\ UNCHANGED <<head, applied, mandatory, proofSeen, acceptedFresh, authorityEffect, mode, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

Apply ==
  /\ applied < received
  /\ applied' = received
  /\ UNCHANGED <<head, received, mandatory, proofSeen, acceptedFresh, authorityEffect, mode, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

SealVisibility ==
  /\ applied = received
  /\ roundStatus # "OPEN"
  /\ proofSeen' = applied
  /\ mandatory' = {sequence \in mandatory : sequence > applied}
  /\ UNCHANGED <<head, received, applied, acceptedFresh, authorityEffect, mode, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

OpenRound ==
  /\ mode = "COLLABORATE"
  /\ mandatory = {}
  /\ applied = head
  /\ proofSeen = head
  /\ roundStatus \in {"IDLE", "SEALED", "ABANDONED"}
  /\ roundSeq < MaxSeq
  /\ roundStatus' = "OPEN"
  /\ roundBase' = head
  /\ roundSeq' = roundSeq + 1
  /\ gptSubmitted' = FALSE
  /\ glmSubmitted' = FALSE
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, authorityEffect, mode>>

SubmitGPT ==
  /\ roundStatus = "OPEN"
  /\ mode = "COLLABORATE"
  /\ mandatory = {}
  /\ proofSeen = roundBase
  /\ ~gptSubmitted
  /\ head < MaxSeq
  /\ head' = head + 1
  /\ gptSubmitted' = TRUE
  /\ acceptedFresh' = TRUE
  /\ UNCHANGED <<received, applied, mandatory, proofSeen, authorityEffect, mode, roundStatus, roundBase, roundSeq, glmSubmitted>>

SubmitGLM ==
  /\ roundStatus = "OPEN"
  /\ mode = "COLLABORATE"
  /\ mandatory = {}
  /\ proofSeen = roundBase
  /\ ~glmSubmitted
  /\ head < MaxSeq
  /\ head' = head + 1
  /\ glmSubmitted' = TRUE
  /\ acceptedFresh' = TRUE
  /\ UNCHANGED <<received, applied, mandatory, proofSeen, authorityEffect, mode, roundStatus, roundBase, roundSeq, gptSubmitted>>

SealRound ==
  /\ roundStatus = "OPEN"
  /\ gptSubmitted /\ glmSubmitted
  /\ roundStatus' = "SEALED"
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, authorityEffect, mode, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

AbandonRound ==
  /\ roundStatus = "OPEN"
  /\ (mandatory # {} \/ mode # "COLLABORATE")
  /\ roundStatus' = "ABANDONED"
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, authorityEffect, mode, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

OpenDuel ==
  /\ mode = "COLLABORATE"
  /\ mode' = "DUEL"
  /\ acceptedFresh' = FALSE
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, authorityEffect, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

ResolveDuel ==
  /\ mode = "DUEL"
  /\ mode' = "COLLABORATE"
  /\ UNCHANGED <<head, received, applied, mandatory, proofSeen, acceptedFresh, authorityEffect, roundStatus, roundBase, roundSeq, gptSubmitted, glmSubmitted>>

Disconnect == UNCHANGED vars

Next == CommitP0P1 \/ CommitP2P3 \/ Receive \/ Apply \/
        SealVisibility \/ OpenRound \/ SubmitGPT \/ SubmitGLM \/ SealRound \/
        AbandonRound \/ OpenDuel \/ ResolveDuel \/ Disconnect

CursorOrder == proofSeen <= applied /\ applied <= received /\ received <= head
MandatoryBounded == mandatory \subseteq (1..head)
AcceptanceFresh == acceptedFresh => mandatory = {}
AcceptanceModeSafe == acceptedFresh => mode = "COLLABORATE"
AuthorityIsolation == authorityEffect = FALSE
ModeValid == mode \in {"COLLABORATE", "DUEL"}
RoundStatusValid == roundStatus \in {"IDLE", "OPEN", "SEALED", "ABANDONED"}
RoundBaseBounded == roundBase <= head
SealedRoundComplete == roundStatus = "SEALED" => gptSubmitted /\ glmSubmitted
SubmittedRoundLive == (gptSubmitted \/ glmSubmitted) => roundStatus \in {"OPEN", "SEALED", "ABANDONED"}
AcceptedAtRoundBase == acceptedFresh => proofSeen = roundBase

====

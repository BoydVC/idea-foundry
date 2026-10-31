------------------------------ MODULE foundry ------------------------------
EXTENDS Integers

\* CHART raw restated restate
\* CHART raw parked park
\* CHART restated approved approve
\* CHART restated parked park
\* CHART approved specced decompose
\* CHART approved parked park
\* CHART specced gated gate_pass
\* CHART specced specced gate_fail
\* CHART specced parked park
\* CHART gated specced gate_fail
\* CHART gated gated gate_pass
\* CHART gated dispatched dispatch
\* CHART gated parked park
\* CHART dispatched verified verify_draft
\* CHART dispatched rejected reject_draft
\* CHART dispatched parked park

VARIABLES
  phase, idea, s1, s2, ver, d1, d2, g1, g2,
  aRead, bRead, aDone, bDone, casValue

vars == <<phase, idea, s1, s2, ver, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

VerBound == ver <= 16

Init ==
  /\ phase = "cas"
  /\ idea = "raw"
  /\ s1 = "absent"
  /\ s2 = "absent"
  /\ ver = 0
  /\ d1 = FALSE
  /\ d2 = FALSE
  /\ g1 = FALSE
  /\ g2 = FALSE
  /\ aRead = -1
  /\ bRead = -1
  /\ aDone = FALSE
  /\ bDone = FALSE
  /\ casValue = 0

ARead ==
  /\ phase = "cas"
  /\ aRead = -1
  /\ ver = 0
  /\ aRead' = ver
  /\ UNCHANGED <<phase, idea, s1, s2, ver, d1, d2, g1, g2, bRead, aDone, bDone, casValue>>

BRead ==
  /\ phase = "cas"
  /\ bRead = -1
  /\ ver = 0
  /\ bRead' = ver
  /\ UNCHANGED <<phase, idea, s1, s2, ver, d1, d2, g1, g2, aRead, aDone, bDone, casValue>>

AWrite ==
  /\ phase = "cas"
  /\ aDone = FALSE
  /\ aRead >= 0
  /\ bRead >= 0
  /\ aRead = ver
  /\ ver' = ver + 1
  /\ casValue' = casValue + 1
  /\ aDone' = TRUE
  /\ UNCHANGED <<phase, idea, s1, s2, d1, d2, g1, g2, aRead, bRead, bDone>>

AStale ==
  /\ phase = "cas"
  /\ aDone = FALSE
  /\ aRead >= 0
  /\ bRead >= 0
  /\ aRead < ver
  /\ aDone' = TRUE
  /\ UNCHANGED <<phase, idea, s1, s2, ver, d1, d2, g1, g2, aRead, bRead, bDone, casValue>>

BWrite ==
  /\ phase = "cas"
  /\ bDone = FALSE
  /\ bRead >= 0
  /\ aRead >= 0
  /\ bRead = ver
  /\ ver' = ver + 1
  /\ casValue' = casValue + 1
  /\ bDone' = TRUE
  /\ UNCHANGED <<phase, idea, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone>>

BStale ==
  /\ phase = "cas"
  /\ bDone = FALSE
  /\ bRead >= 0
  /\ aRead >= 0
  /\ bRead < ver
  /\ bDone' = TRUE
  /\ UNCHANGED <<phase, idea, s1, s2, ver, d1, d2, g1, g2, aRead, bRead, aDone, casValue>>

FinishCas ==
  /\ phase = "cas"
  /\ aDone = TRUE
  /\ bDone = TRUE
  /\ phase' = "flow"
  /\ UNCHANGED <<idea, s1, s2, ver, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Restate ==
  /\ phase = "flow"
  /\ idea = "raw"
  /\ idea' = "restated"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Approve ==
  /\ phase = "flow"
  /\ idea = "restated"
  /\ idea' = "approved"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Decompose ==
  /\ phase = "flow"
  /\ idea = "approved"
  /\ idea' = "specced"
  /\ s1' = "specced"
  /\ s2' = "specced"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

GatePass1 ==
  /\ phase = "flow"
  /\ s1 = "specced"
  /\ s1' = "gated"
  /\ g1' = TRUE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s2, d1, d2, g2, aRead, bRead, aDone, bDone, casValue>>

GatePass2 ==
  /\ phase = "flow"
  /\ s2 = "specced"
  /\ s2' = "gated"
  /\ g2' = TRUE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s1, d1, d2, g1, aRead, bRead, aDone, bDone, casValue>>

GateFail1 ==
  /\ phase = "flow"
  /\ s1 = "gated"
  /\ s1' = "specced"
  /\ g1' = FALSE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s2, d1, d2, g2, aRead, bRead, aDone, bDone, casValue>>

GateFail2 ==
  /\ phase = "flow"
  /\ s2 = "gated"
  /\ s2' = "specced"
  /\ g2' = FALSE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s1, d1, d2, g1, aRead, bRead, aDone, bDone, casValue>>

GateIdea ==
  /\ phase = "flow"
  /\ idea = "specced"
  /\ s1 = "gated"
  /\ s2 = "gated"
  /\ idea' = "gated"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

GateFailIdea ==
  /\ phase = "flow"
  /\ idea = "gated"
  /\ (s1 = "specced" \/ s2 = "specced")
  /\ idea' = "specced"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Dispatch1 ==
  /\ phase = "flow"
  /\ s1 = "gated"
  /\ g1 = TRUE
  /\ s1' = "dispatched"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Dispatch2 ==
  /\ phase = "flow"
  /\ s2 = "gated"
  /\ g2 = TRUE
  /\ s2' = "dispatched"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s1, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

DispatchIdea ==
  /\ phase = "flow"
  /\ idea = "gated"
  /\ s1 \in {"dispatched", "verified", "rejected"}
  /\ s2 \in {"dispatched", "verified", "rejected"}
  /\ idea' = "dispatched"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

IngestOk1 ==
  /\ phase = "flow"
  /\ s1 = "dispatched"
  /\ s1' = "verified"
  /\ d1' = TRUE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s2, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

IngestReject1 ==
  /\ phase = "flow"
  /\ s1 = "dispatched"
  /\ s1' = "rejected"
  /\ d1' = TRUE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s2, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

IngestOk2 ==
  /\ phase = "flow"
  /\ s2 = "dispatched"
  /\ s1 = "verified"
  /\ s2' = "verified"
  /\ d2' = TRUE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s1, d1, g1, g2, aRead, bRead, aDone, bDone, casValue>>

IngestReject2 ==
  /\ phase = "flow"
  /\ s2 = "dispatched"
  /\ s1 \in {"verified", "rejected"}
  /\ s2' = "rejected"
  /\ d2' = TRUE
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s1, d1, g1, g2, aRead, bRead, aDone, bDone, casValue>>

CloseIdea ==
  /\ phase = "flow"
  /\ idea = "dispatched"
  /\ s1 = "verified"
  /\ s2 = "verified"
  /\ idea' = "verified"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

RejectIdea ==
  /\ phase = "flow"
  /\ idea = "dispatched"
  /\ (s1 = "rejected" \/ s2 = "rejected")
  /\ s1 \in {"verified", "rejected"}
  /\ s2 \in {"verified", "rejected"}
  /\ idea' = "rejected"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

ParkIdea ==
  /\ phase = "flow"
  /\ idea \in {"raw", "restated", "approved", "specced", "gated", "dispatched"}
  /\ idea' = "parked"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, s1, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Park1 ==
  /\ phase = "flow"
  /\ s1 \in {"specced", "gated", "dispatched"}
  /\ s1' = "parked"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s2, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Park2 ==
  /\ phase = "flow"
  /\ s2 \in {"specced", "gated", "dispatched"}
  /\ s2' = "parked"
  /\ ver' = ver + 1
  /\ UNCHANGED <<phase, idea, s1, d1, d2, g1, g2, aRead, bRead, aDone, bDone, casValue>>

Idle ==
  /\ phase = "flow"
  /\ UNCHANGED vars

LifeNext ==
  \/ ARead \/ BRead \/ AWrite \/ AStale \/ BWrite \/ BStale \/ FinishCas
  \/ Restate \/ Approve \/ Decompose
  \/ GatePass1 \/ GatePass2 \/ GateFail1 \/ GateFail2
  \/ GateIdea \/ GateFailIdea
  \/ Dispatch1 \/ Dispatch2 \/ DispatchIdea
  \/ IngestOk1 \/ IngestReject1 \/ IngestOk2 \/ IngestReject2
  \/ CloseIdea \/ RejectIdea
  \/ ParkIdea \/ Park1 \/ Park2
  \/ Idle

Next == LifeNext

NoMergeState ==
  /\ idea # "merged"
  /\ s1 # "merged"
  /\ s2 # "merged"

VerifiedImpliesDraftPR ==
  /\ (s1 = "verified" => d1 = TRUE)
  /\ (s2 = "verified" => d2 = TRUE)

StackLandsBottomUp ==
  s2 = "verified" => s1 = "verified"

CASNoLostUpdate ==
  (aDone = TRUE /\ bDone = TRUE /\ aRead = bRead /\ aRead >= 0) => casValue = aRead + 1

Spec == Init /\ [][Next]_vars

=============================================================================

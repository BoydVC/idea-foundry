------------------------------ MODULE foundry ------------------------------
EXTENDS Integers

CONSTANT SkipGate, AllowMerge, LoseUpdate
ASSUME SkipGate \in BOOLEAN /\ AllowMerge \in BOOLEAN /\ LoseUpdate \in BOOLEAN

VARIABLES idea, s1, s2, draft1, draft2, g1, g2, stored, commits, aRead, bRead, aDone, bDone

vars == <<idea, s1, s2, draft1, draft2, g1, g2, stored, commits, aRead, bRead, aDone, bDone>>

Init ==
  /\ idea = "raw"
  /\ s1 = "absent"
  /\ s2 = "absent"
  /\ draft1 = FALSE
  /\ draft2 = FALSE
  /\ g1 = FALSE
  /\ g2 = FALSE
  /\ stored = 0
  /\ commits = 0
  /\ aRead = -1
  /\ bRead = -1
  /\ aDone = FALSE
  /\ bDone = FALSE

\* event: restate
Restate ==
  /\ idea = "raw"
  /\ idea' = "restated"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: approve
Approve ==
  /\ idea = "restated"
  /\ idea' = "approved"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: decompose
Decompose ==
  /\ idea = "approved"
  /\ idea' = "specced"
  /\ s1 = "absent"
  /\ s1' = "specced"
  /\ s2 = "absent"
  /\ s2' = "specced"
  /\ UNCHANGED <<draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: gate_pass
Gate1 ==
  /\ s1 = "specced"
  /\ s1' = "gated"
  /\ draft1' = TRUE
  /\ g1' = TRUE
  /\ UNCHANGED <<idea, s2, draft2, g2, stored, commits, aRead, bRead, aDone, bDone>>

\* event: gate_pass
Gate2 ==
  /\ s2 = "specced"
  /\ s2' = "gated"
  /\ draft2' = TRUE
  /\ g2' = TRUE
  /\ UNCHANGED <<idea, s1, draft1, g1, stored, commits, aRead, bRead, aDone, bDone>>

\* event: gate_pass
PassIdea ==
  /\ idea = "specced"
  /\ s1 = "gated"
  /\ s2 = "gated"
  /\ idea' = "gated"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: dispatch
Dispatch1 ==
  /\ s1 = "gated"
  /\ g1
  /\ s1' = "dispatched"
  /\ UNCHANGED <<idea, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: dispatch
Dispatch2 ==
  /\ s2 = "gated"
  /\ g2
  /\ s2' = "dispatched"
  /\ UNCHANGED <<idea, s1, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: verify
Verify1 ==
  /\ s1 = "dispatched"
  /\ draft1 = TRUE
  /\ s1' = "verified"
  /\ UNCHANGED <<idea, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: verify
Verify2 ==
  /\ s2 = "dispatched"
  /\ draft2 = TRUE
  /\ s1 = "verified"
  /\ s2' = "verified"
  /\ UNCHANGED <<idea, s1, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: reject
Reject1 ==
  /\ s1 = "dispatched"
  /\ s1' = "rejected"
  /\ UNCHANGED <<idea, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: reject
Reject2 ==
  /\ s2 = "dispatched"
  /\ s2' = "rejected"
  /\ UNCHANGED <<idea, s1, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: gate_fail
GateFail1 ==
  /\ s1 = "gated"
  /\ s1' = "specced"
  /\ draft1' = FALSE
  /\ g1' = FALSE
  /\ UNCHANGED <<idea, s2, draft2, g2, stored, commits, aRead, bRead, aDone, bDone>>

\* event: close
Close ==
  /\ idea = "gated"
  /\ s1 = "verified"
  /\ s2 = "verified"
  /\ idea' = "verified"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: park
ParkRaw ==
  /\ idea = "raw"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: park
ParkRestated ==
  /\ idea = "restated"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: park
ParkApproved ==
  /\ idea = "approved"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: park
ParkSpecced ==
  /\ idea = "specced"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: park
ParkGated ==
  /\ idea = "gated"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

\* event: park
ParkDispatched ==
  /\ idea = "dispatched"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2, aDone, bDone>>

ReadA ==
  /\ aRead = -1
  /\ aDone = FALSE
  /\ stored < 3
  /\ aRead' = stored
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, bRead, aDone, bDone, g1, g2>>

ReadB ==
  /\ bRead = -1
  /\ bDone = FALSE
  /\ stored < 3
  /\ bRead' = stored
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, aRead, aDone, bDone, g1, g2>>

CommitA ==
  /\ aDone = FALSE
  /\ aRead >= 0
  /\ aRead = stored
  /\ stored < 3
  /\ stored' = stored + 1
  /\ commits' = commits + 1
  /\ aDone' = TRUE
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, aRead, bRead, bDone, g1, g2>>

CommitB ==
  /\ bDone = FALSE
  /\ bRead >= 0
  /\ bRead = stored
  /\ stored < 3
  /\ stored' = stored + 1
  /\ commits' = commits + 1
  /\ bDone' = TRUE
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, aRead, bRead, aDone, g1, g2>>

DropA ==
  /\ aDone = FALSE
  /\ aRead >= 0
  /\ aRead # stored
  /\ aDone' = TRUE
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, aRead, bRead, bDone, g1, g2>>

DropB ==
  /\ bDone = FALSE
  /\ bRead >= 0
  /\ bRead # stored
  /\ bDone' = TRUE
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, aRead, bRead, aDone, g1, g2>>


\* Not a chart edge. Enabled only when SkipGate is true.
SkipGateDispatch ==
  /\ SkipGate
  /\ s1 = "specced"
  /\ s1' = "dispatched"
  /\ draft1' = TRUE
  /\ g1' = FALSE
  /\ UNCHANGED <<idea, s2, draft2, g2, stored, commits, aRead, bRead, aDone, bDone>>

\* Not a chart edge. Enabled only when AllowMerge is true.
MergeSpec ==
  /\ AllowMerge
  /\ s1 \in {"dispatched", "verified", "gated"}
  /\ s1' = "merged"
  /\ UNCHANGED <<idea, s2, draft1, draft2, g1, g2, stored, commits, aRead, bRead, aDone, bDone>>

\* Not a chart edge. Enabled only when LoseUpdate is true.
DoubleCommit ==
  /\ LoseUpdate
  /\ aRead = 0
  /\ bRead = 0
  /\ aDone = FALSE
  /\ bDone = FALSE
  /\ stored' = 2
  /\ commits' = 2
  /\ aDone' = TRUE
  /\ bDone' = TRUE
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, g1, g2, aRead, bRead>>

Next ==
  \/ Restate
  \/ Approve
  \/ Decompose
  \/ Gate1
  \/ Gate2
  \/ PassIdea
  \/ Dispatch1
  \/ Dispatch2
  \/ Verify1
  \/ Verify2
  \/ Reject1
  \/ Reject2
  \/ GateFail1
  \/ Close
  \/ ParkRaw
  \/ ParkRestated
  \/ ParkApproved
  \/ ParkSpecced
  \/ ParkGated
  \/ ParkDispatched
  \/ ReadA
  \/ ReadB
  \/ CommitA
  \/ CommitB
  \/ DropA
  \/ DropB
  \/ SkipGateDispatch
  \/ MergeSpec
  \/ DoubleCommit

Spec == Init /\ [][Next]_vars

Allowed == {
  "raw", "restated", "approved", "specced", "gated",
  "dispatched", "verified", "rejected", "parked", "absent", "merged"
  }

TypeOK ==
  /\ idea \in Allowed
  /\ s1 \in Allowed
  /\ s2 \in Allowed
  /\ draft1 \in BOOLEAN
  /\ draft2 \in BOOLEAN
  /\ g1 \in BOOLEAN
  /\ g2 \in BOOLEAN
  /\ stored \in 0..3
  /\ commits \in 0..3
  /\ aRead \in -1..3
  /\ bRead \in -1..3
  /\ aDone \in BOOLEAN
  /\ bDone \in BOOLEAN

NoMergeState ==
  /\ idea \in Allowed
  /\ s1 \in Allowed
  /\ s2 \in Allowed
  /\ idea # "merged"
  /\ s1 # "merged"
  /\ s2 # "merged"

VerifiedImpliesDraftPR ==
  /\ (s1 = "verified" => draft1)
  /\ (s2 = "verified" => draft2)

StackLandsBottomUp == s2 = "verified" => s1 = "verified"

CASNoLostUpdate ==
  /\ commits = stored
  /\ ((aDone /\ bDone /\ aRead = bRead /\ aRead >= 0) => stored = aRead + 1)

DispatchRequiresGate ==
  /\ (s1 \in {"dispatched", "verified", "rejected"} => g1)
  /\ (s2 \in {"dispatched", "verified", "rejected"} => g2)

=============================================================================

------------------------------ MODULE foundry_mutant ------------------------------
EXTENDS Integers
\* MUTANT skips the G-gate for spec 1 and still sets the draft flag.

VARIABLES idea, s1, s2, draft1, draft2, g1, g2, stored, commits, aRead, bRead

vars == <<idea, s1, s2, draft1, draft2, g1, g2, stored, commits, aRead, bRead>>

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

\* event: restate
Restate ==
  /\ idea = "raw"
  /\ idea' = "restated"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: approve
Approve ==
  /\ idea = "restated"
  /\ idea' = "approved"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: decompose
Decompose ==
  /\ idea = "approved"
  /\ idea' = "specced"
  /\ s1 = "absent"
  /\ s1' = "specced"
  /\ s2 = "absent"
  /\ s2' = "specced"
  /\ UNCHANGED <<draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: gate_pass
Gate1 ==
  /\ s1 = "specced"
  /\ s1' = "gated"
  /\ draft1' = TRUE
  /\ g1' = TRUE
  /\ UNCHANGED <<idea, s2, draft2, g2, stored, commits, aRead, bRead>>

\* event: gate_pass
Gate2 ==
  /\ s2 = "specced"
  /\ s2' = "gated"
  /\ draft2' = TRUE
  /\ g2' = TRUE
  /\ UNCHANGED <<idea, s1, draft1, g1, stored, commits, aRead, bRead>>

\* event: gate_pass
PassIdea ==
  /\ idea = "specced"
  /\ s1 = "gated"
  /\ s2 = "gated"
  /\ idea' = "gated"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>


\* event: dispatch
Dispatch1Skip ==
  /\ s1 = "specced"
  /\ s1' = "dispatched"
  /\ draft1' = TRUE
  /\ g1' = FALSE
  /\ UNCHANGED <<idea, s2, draft2, g2, stored, commits, aRead, bRead>>

\* event: dispatch
Dispatch1 ==
  /\ s1 = "gated"
  /\ g1
  /\ s1' = "dispatched"
  /\ UNCHANGED <<idea, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: dispatch
Dispatch2 ==
  /\ s2 = "gated"
  /\ g2
  /\ s2' = "dispatched"
  /\ UNCHANGED <<idea, s1, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: verify
Verify1 ==
  /\ s1 = "dispatched"
  /\ draft1 = TRUE
  /\ s1' = "verified"
  /\ UNCHANGED <<idea, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: verify
Verify2 ==
  /\ s2 = "dispatched"
  /\ draft2 = TRUE
  /\ s1 = "verified"
  /\ s2' = "verified"
  /\ UNCHANGED <<idea, s1, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: reject
Reject1 ==
  /\ s1 = "dispatched"
  /\ s1' = "rejected"
  /\ UNCHANGED <<idea, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: reject
Reject2 ==
  /\ s2 = "dispatched"
  /\ s2' = "rejected"
  /\ UNCHANGED <<idea, s1, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: gate_fail
GateFail1 ==
  /\ s1 = "gated"
  /\ s1' = "specced"
  /\ draft1' = FALSE
  /\ g1' = FALSE
  /\ UNCHANGED <<idea, s2, draft2, g2, stored, commits, aRead, bRead>>

\* event: close
Close ==
  /\ idea = "gated"
  /\ s1 = "verified"
  /\ s2 = "verified"
  /\ idea' = "verified"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: park
ParkRaw ==
  /\ idea = "raw"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: park
ParkRestated ==
  /\ idea = "restated"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: park
ParkApproved ==
  /\ idea = "approved"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: park
ParkSpecced ==
  /\ idea = "specced"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: park
ParkGated ==
  /\ idea = "gated"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

\* event: park
ParkDispatched ==
  /\ idea = "dispatched"
  /\ idea' = "parked"
  /\ UNCHANGED <<s1, s2, draft1, draft2, stored, commits, aRead, bRead, g1, g2>>

ReadA ==
  /\ aRead = -1
  /\ stored < 3
  /\ aRead' = stored
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, bRead, g1, g2>>

ReadB ==
  /\ bRead = -1
  /\ stored < 3
  /\ bRead' = stored
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, aRead, g1, g2>>

CommitA ==
  /\ aRead >= 0
  /\ aRead = stored
  /\ stored < 3
  /\ stored' = stored + 1
  /\ commits' = commits + 1
  /\ aRead' = -1
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, bRead, g1, g2>>

CommitB ==
  /\ bRead >= 0
  /\ bRead = stored
  /\ stored < 3
  /\ stored' = stored + 1
  /\ commits' = commits + 1
  /\ bRead' = -1
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, aRead, g1, g2>>

DropA ==
  /\ aRead >= 0
  /\ aRead # stored
  /\ aRead' = -1
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, bRead, g1, g2>>

DropB ==
  /\ bRead >= 0
  /\ bRead # stored
  /\ bRead' = -1
  /\ UNCHANGED <<idea, s1, s2, draft1, draft2, stored, commits, aRead, g1, g2>>

Next ==
  \/ Restate
  \/ Approve
  \/ Decompose
  \/ Gate1
  \/ Gate2
  \/ PassIdea
  \/ Dispatch1
  \/ Dispatch1Skip
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

Spec == Init /\ [][Next]_vars

Allowed == {
  "raw", "restated", "approved", "specced", "gated",
  "dispatched", "verified", "rejected", "parked", "absent"
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

CASNoLostUpdate == stored = commits

DispatchRequiresGate ==
  /\ (s1 \in {"dispatched", "verified", "rejected"} => g1)
  /\ (s2 \in {"dispatched", "verified", "rejected"} => g2)

=============================================================================

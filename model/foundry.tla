------------------------------ MODULE foundry ------------------------------
EXTENDS Integers

CONSTANT MaxVer, SkipGate

ASSUME MaxVer \in Nat /\ MaxVer >= 8
ASSUME SkipGate \in BOOLEAN

States == {
  "raw", "restated", "approved", "specced", "gated",
  "dispatched", "verified", "rejected", "parked"
}

\* One row is one legal step of transition(). Guards are separate lines.
TransitionTable == {
  <<"raw", "restate", "restated">>,
  <<"restated", "approve", "approved">>,
  <<"approved", "decompose", "specced">>,
  <<"specced", "gate_pass", "gated">>,
  <<"gated", "gate_fail", "specced">>,
  <<"gated", "dispatch", "dispatched">>,
  <<"dispatched", "ingest_verified", "verified">>,
  <<"dispatched", "ingest_rejected", "rejected">>,
  <<"raw", "park", "parked">>,
  <<"restated", "park", "parked">>,
  <<"approved", "park", "parked">>,
  <<"specced", "park", "parked">>,
  <<"gated", "park", "parked">>,
  <<"rejected", "park", "parked">>
}

\* GUARD ingest_verified draft
\* GUARD ingest_verified belowVerified

Idx == 1..2

VARIABLES
  record,
  s,
  draft,
  passedGate,
  version,
  held,
  used

vars == <<record, s, draft, passedGate, version, held, used>>

VersionBound == version <= MaxVer

Init ==
  /\ record = "raw"
  /\ s = [i \in Idx |-> "idle"]
  /\ draft = [i \in Idx |-> FALSE]
  /\ passedGate = [i \in Idx |-> FALSE]
  /\ version = 0
  /\ held = 0
  /\ used = {}

Commit ==
  /\ version' = version + 1
  /\ held' = version + 1
  /\ used' = used \cup {version}

BelowOk(i) ==
  IF i = 1 THEN TRUE ELSE s[i - 1] = "verified"

Apply(i, ev) ==
  \E row \in TransitionTable :
    /\ row[2] = ev
    /\ s[i] = row[1]
    /\ s' = [s EXCEPT ![i] = row[3]]

IdeaMove ==
  /\ held = version
  /\ \E row \in TransitionTable :
      /\ row[2] \in {"restate", "approve", "decompose", "park"}
      /\ record = row[1]
      /\ record' = row[3]
      /\ IF row[2] = "decompose"
         THEN /\ s[1] = "idle"
              /\ s' = [i \in Idx |-> "specced"]
         ELSE s' = s
  /\ draft' = draft
  /\ passedGate' = passedGate
  /\ Commit

GatePass(i) ==
  /\ held = version
  /\ Apply(i, "gate_pass")
  /\ passedGate' = [passedGate EXCEPT ![i] = TRUE]
  /\ record' = record
  /\ draft' = draft
  /\ Commit

GateFail(i) ==
  /\ held = version
  /\ Apply(i, "gate_fail")
  /\ passedGate' = [passedGate EXCEPT ![i] = FALSE]
  /\ record' = record
  /\ draft' = draft
  /\ Commit

Dispatch(i) ==
  /\ held = version
  /\ Apply(i, "dispatch")
  /\ passedGate[i] = TRUE
  /\ record' = record
  /\ draft' = draft
  /\ passedGate' = passedGate
  /\ Commit

\* Mutation: dispatch straight from specced, leaving passedGate false.
SkipGateDispatch(i) ==
  /\ SkipGate
  /\ held = version
  /\ s[i] = "specced"
  /\ s' = [s EXCEPT ![i] = "dispatched"]
  /\ passedGate' = passedGate
  /\ record' = record
  /\ draft' = draft
  /\ Commit

IngestVerified(i) ==
  /\ held = version
  /\ Apply(i, "ingest_verified")
  /\ BelowOk(i)
  /\ draft' = [draft EXCEPT ![i] = TRUE]
  /\ record' = record
  /\ passedGate' = passedGate
  /\ Commit

IngestRejected(i) ==
  /\ held = version
  /\ Apply(i, "ingest_rejected")
  /\ draft' = [draft EXCEPT ![i] = FALSE]
  /\ record' = record
  /\ passedGate' = passedGate
  /\ Commit

\* A non-draft ingest is refused. The spec stays dispatched and the version does not move.
IngestNotDraft(i) ==
  /\ s[i] = "dispatched"
  /\ UNCHANGED vars

DropHeld ==
  /\ held # 0
  /\ held' = 0
  /\ UNCHANGED <<record, s, draft, passedGate, version, used>>

Refresh ==
  /\ held # version
  /\ held' = version
  /\ UNCHANGED <<record, s, draft, passedGate, version, used>>

Done ==
  /\ \/ record = "parked"
     \/ \A i \in Idx : s[i] \in {"verified", "rejected"}
  /\ UNCHANGED vars

Next ==
  \/ IdeaMove
  \/ \E i \in Idx : GatePass(i)
  \/ \E i \in Idx : GateFail(i)
  \/ \E i \in Idx : Dispatch(i)
  \/ \E i \in Idx : SkipGateDispatch(i)
  \/ \E i \in Idx : IngestVerified(i)
  \/ \E i \in Idx : IngestRejected(i)
  \/ \E i \in Idx : IngestNotDraft(i)
  \/ DropHeld
  \/ Refresh
  \/ Done

Spec == Init /\ [][Next]_vars

NoMergeState ==
  /\ record # "merged"
  /\ \A i \in Idx : s[i] # "merged"

VerifiedImpliesDraftPR ==
  \A i \in Idx : s[i] = "verified" => draft[i] = TRUE

StackLandsBottomUp ==
  s[2] = "verified" => s[1] = "verified"

CASNoLostUpdate ==
  used = 0..(version - 1)

\* The skip-gate mutation sends a spec to dispatched with passedGate still false.
DispatchRequiresGate ==
  \A i \in Idx : s[i] \in {"dispatched", "verified", "rejected"} => passedGate[i] = TRUE

=============================================================================

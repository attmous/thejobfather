# TheJobFather — Implementation Plan

This plan is ordered by risk, not by screen. The first checkpoint proves the
live-media path because a failure there changes the product and the demo. Work is
delivered through the independently testable increments in
`INCREMENTAL_ROADMAP.md`; the timeboxes below show how those increments fit into
the hackathon window.

## 1. Proposed architecture

Keep one repository and two runtime processes:

```text
Browser / Next.js
  ├─ same-origin HTTP ──> FastAPI ──> SQLite
  │                         ├─ Gemini text API
  │                         └─ ReportLab PDFs
  └─ temporary credential ─────────> Gemini Live
```

- **Next.js / TypeScript:** screens, state, audio capture/playback, screen-frame
  sampling, captions, approval cards, and document previews.
- **FastAPI / Python:** auth, extraction, profile transactions, confirmed job,
  temporary Live credential issuance, allowlisted Live actions, generation,
  validation, persistence, and PDFs.
- **Gemini Live:** full-duplex speech, interruption events, visual screen context,
  and typed action proposals.
- **Gemini text model:** deterministic JSON extraction, drafting, requirement
  matching, and consistency review.
- **SQLite / SQLAlchemy:** approved state and document versions.
- **Codesphere:** HTTPS ingress, secret environment variables, and persistent data
  volume.

The frontend never writes approved facts directly and never receives the
permanent Gemini API key. FastAPI is the authority for durable state.

## 2. Target repository layout

```text
TheGodFather_C/
  frontend/
    app/
    components/
    lib/live/
    lib/api/
  backend/
    app/api/
    app/models/
    app/schemas/
    app/services/
    app/prompts/
    app/templates/
    tests/
  fixtures/
  data/                 # gitignored
  docs/
  .env.example
  compose.yaml          # local convenience only
  README.md
```

## 3. Build sequence and timeboxes

### Phase 0 — prove the riskiest integration (0:00–0:50)

1. Confirm the user's API key can access the selected Gemini Live model and a
   separate text model.
2. Build a disposable browser spike for microphone input, agent playback,
   interruption, finalized captions, and one sampled screen frame.
3. Confirm temporary credentials can be minted server-side and used in the
   browser without exposing the permanent key.
4. Confirm Codesphere can serve HTTPS and preserve a test file across restart.

**Gate:** do not build the full UI until a real Live exchange, interruption, and
screen-frame observation work. If temporary credentials or screen input are not
available for the selected model/account, record the exact blocker immediately.

### Phase 1 — scaffold and contracts (0:50–1:40)

1. Create Next.js and FastAPI apps with pinned dependencies and shared local
   commands.
2. Define Pydantic request/response schemas before UI integration.
3. Add config validation, health endpoint, SQLAlchemy models, idempotent migration
   or initialization, foreign keys, and SQLite busy timeout.
4. Implement owner-password login, opaque session cookies, logout, and same-origin
   mutation checks.
5. Add synthetic fixtures and provider adapters so routine tests never require a
   paid model call.

**Gate:** login, authenticated health/state request, database restart, and typed
contract tests pass.

### Phase 2 — profile evidence and approval (1:40–2:50)

1. Add bounded PDF upload and `pypdf` text extraction with page locators.
2. Add pasted resume text fallback.
3. Ask the text model for claim proposals in a strict schema.
4. Prefill editable Profile fields from the extraction and confirm them
   together with Save and continue.
5. Implement optimistic profile version checks and a single transaction that
   stores decisions and creates the next materialized profile snapshot.

**Gate:** saved profile details survive restart. Unsaved extractions and edits
cannot be read as approved profile facts.

### Phase 3 — target job and application shell (2:50–3:35)

1. Import a public job link and offer pasted job text if import fails.
2. Extract a strict confirmed-job schema with stable requirement IDs.
3. Show editable role, company, and description on the Job tab. Confirm the
   details when the user selects Start session.
4. Build Session with Chat and Call modes and a shared Captured facts footer.
   Build Application with CV, Cover letter, and Job fit tabs.

**Gate:** generation and call start are unavailable until the job is confirmed;
job requirements are never stored as profile evidence.

### Phase 4 — production live call path (3:35–5:20)

1. Move the spike into a small `LiveSession` client state machine.
2. Implement microphone PCM conversion, playback queue, interruption clearing,
   finalized captions, reconnect state, and complete track cleanup.
3. Add screen selection by user gesture and bounded JPEG sampling; send only when
   sharing is active.
4. Supply the live system prompt with the pinned profile and confirmed job.
5. Implement allowlisted tool/action parsing with provider action IDs and stale
   action rejection.
6. Route chat and call proposals into the same footer. Append each fact in
   order and keep it visible after Add to profile succeeds. Refresh context
   after backend approval.

**Gate:** one real session demonstrates interruption, a screen-aware question,
and a proposed fact that remains absent from the durable profile until clicked.

### Phase 5 — generation, validation, and versioning (5:20–6:55)

1. Build structured generation prompts for CV, cover letter, and fit analysis.
2. Require claim IDs on factual blocks and requirement IDs on fit items.
3. Run deterministic validation first: IDs exist, claims are approved, versions
   match, and material numbers/dates have evidence.
4. Run a separate model consistency review for unsupported paraphrases and
   negation/contribution errors.
5. Persist a run only after schema validation; expose `running`, `succeeded`, and
   `failed` polling states.
6. Render all outputs in tabs with compact evidence drill-down.

**Gate:** adversarial fixtures for an invented skill, metric, title, and personal
contribution are blocked or flagged; all outputs share one snapshot pair.

### Phase 6 — spoken revision and PDFs (6:55–8:05)

1. Convert `revise_draft` Live actions into typed section, instruction, and base
   run ID.
2. Permit style/emphasis changes using approved facts; route newly asserted facts
   back to the approval rail.
3. Save successful revisions as child runs without overwriting the parent.
4. Render CV and cover letter through fixed ReportLab templates using a bundled
   licensed Unicode font.
5. Test selectable text, multi-page content, long bullets, links, and special
   characters.

**Gate:** a spoken “shorter and more direct” request creates a new version, and
both exported PDFs pass text extraction checks.

### Phase 7 — harden, deploy, and rehearse (8:05–10:00)

1. Test auth boundaries, upload limits, malformed model JSON, provider timeout,
   denied microphone, stopped sharing, disconnect, stale versions, and failed
   revision preservation.
2. Add P1 GitHub import only if every P0 gate is green by 8:30.
3. Deploy one instance; verify same-origin API proxy, Secure cookie, secrets,
   HTTPS media permissions, and persistence after restart.
4. Run the exact synthetic demo end-to-end on the hosted build.
5. Open and visually inspect exported PDFs.
6. Record a clearly labeled backup demo only after the live path has been tested.
7. Document verified behavior, setup commands, and honest limitations.

## 4. Implementation details that prevent expensive rework

### Typed model boundaries

Treat every model response as untrusted input. Parse it into strict Pydantic
schemas and reject extra or invalid fields. Store prompt and model versions on
each generation run.

### Snapshot pinning

When a call or generation begins, pin `profile_version` and `job_version`.
Approving a new fact creates a new profile version; the UI can then explicitly
use it for the next generation. This prevents different outputs from silently
using different facts.

### Approval transaction

The approval request carries the expected profile version and the visible
proposal IDs. FastAPI verifies both, stores the accepted/corrected claims, and
creates the new profile snapshot in one short transaction. Return `409` when the
version is stale.

### Live client state machine

Use explicit states—`idle`, `connecting`, `active`, `reconnecting`, `ending`,
`ended`, `error`—instead of scattered booleans. Associate playback and actions
with a session generation so late events from an interrupted or reconnected
session are ignored.

### Generation safety

Generate structured document blocks, not HTML. A block includes text and its
supporting claim IDs. The PDF renderer consumes validated blocks only. Never
allow arbitrary model HTML or Markdown to control PDF layout.

### Provider isolation

Put Gemini Live and text calls behind small adapters. Tests use deterministic
fakes; one opt-in integration suite uses the real credentials. This keeps routine
development fast and makes model changes localized.

## 5. Test plan

### Backend automated tests

- Auth required on every personal-data route.
- PDF size/signature checks and text fallback behavior.
- Proposal state transitions and profile optimistic locking.
- Rejected/unapproved claim exclusion.
- Confirmed-job version requirement.
- Evidence ID and pinned snapshot validation.
- Generation failure and revision-parent preservation.
- PDF creation and extracted-text assertions.

### Frontend automated tests

- Approval-card editing and disabled states.
- Application gates before job confirmation.
- Live state-machine transitions.
- Playback queue cleared on interruption.
- Screen capture stops on browser `ended` event and call end.
- Stale action IDs do not update the current session.

### Manual hosted checks

- Chrome microphone and screen permissions.
- Real interruption latency and caption finalization.
- Visible screen detail produces a grounded follow-up.
- Reconnect keeps approved state and working documents.
- Restart preserves SQLite data.
- Final CV and letter visual quality.

## 6. Cut order if time slips

Cut in this order without weakening the approval gate:

1. GitHub import.
2. LinkedIn-specific labeling.
3. Job URL fetching.
4. Remote camera vision.
5. Fit-analysis PDF.
6. Rich evidence views and document diff.
7. Multiple saved-application conveniences.

Do not cut full-duplex live audio, interruption, optional screen sharing, explicit
fact approval, evidence-bound generation, same-call revision, or CV/letter PDF
downloads. Those features are the MVP's product claim.

## 7. Work immediately after MVP agreement

Once the open product decisions are confirmed:

1. Scaffold both apps and pin dependencies.
2. Run the Phase 0 Gemini/Codesphere spike.
3. Freeze API schemas based on the spike's actual SDK event shapes.
4. Implement phases in order, stopping at every gate to test the vertical slice.

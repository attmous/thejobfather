# Product Decisions to Confirm

The refined MVP is implementable as written, but these decisions should be
explicit before the build starts.

## Recommended defaults

1. **Product name:** Use “TheJobFather” in the UI while keeping the requested
   repository name `TheGodFather_C`.
2. **P0 evidence input:** Resume PDF or pasted resume text only. Treat LinkedIn
   PDF and one GitHub repository as P1.
3. **P0 job input:** Job link first, with a pasted description as fallback.
4. **P0 visual input:** Screen sharing to Gemini; keep the camera as local preview
   or omit it until P1.
5. **Fit result:** Show a categorical analysis in the app; export only the CV and
   cover letter as P0 PDFs.
6. **Data scope:** One owner and one deployment, with no production-grade account
   recovery or multi-device synchronization.
7. **Delivery rule:** If real Gemini Live access is unavailable, pause and report
   the blocker instead of silently redefining the MVP as text chat.

## Choices that materially change effort

- Making GitHub, LinkedIn, and remote camera vision all mandatory
  adds several independent failure surfaces and makes the ten-hour estimate
  unrealistic.
- Requiring production-grade source revocation/deletion, comprehensive audit
  history, or multi-user isolation changes this from a hackathon prototype into a
  longer security and data-lifecycle project.
- Supporting mobile browsers in the first build substantially expands media and
  screen-sharing compatibility work. Desktop Chrome is the recommended demo
  target.

Unless changed during refinement, implementation should use the recommended
defaults above.

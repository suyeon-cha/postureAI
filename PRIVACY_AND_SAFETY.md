# FlowReset Privacy, Consent, and Safety Controls

Updated July 26, 2026. This document describes the hackathon prototype. It is
not legal advice, a compliance certification, or a substitute for production
privacy, security, accessibility, clinical, and employment-law review.

## Product boundary

FlowReset is an adult general-wellness product for voluntary desk-work breaks.
It is not medical care, physical therapy, an emergency service, or a medical
device. It does not diagnose, treat, cure, prevent, or monitor a disease or
injury. Camera feedback checks selected visible movement signals and can miss
unsafe form, pain, mobility limitations, and conditions that are not visible.

## Data map

| Data | Source | Purpose | Prototype retention |
|---|---|---|---|
| Goals, preferences, optional concerns | Employee | Personalize resets | Local GB10 until changed or deleted |
| Body area, routine, duration, completion, response | Session | Run resets and create My insights | Local GB10 until deleted |
| Camera frames and pose landmarks | Optional webcam | Session-only movement feedback | Memory only; discarded during processing |
| Voice recording | Optional microphone | Local transcription | Temporary file deleted after transcription |
| Consent state, notice version, timestamp | Employee | Gate future collection and document the notice accepted | Browser-local until withdrawn or deleted; included in export |

No external AI API receives these data. The prototype has no advertising,
data broker, or health-data sale path.

## Employee controls implemented

1. First-use affirmative consent before collecting wellness preferences or
   starting a personalized reset.
2. Separate, just-in-time camera disclosure and consent for each session.
3. Employer aggregation off by default with a separate affirmative opt-in.
4. Export of preferences and session history as JSON.
5. Deletion of local preferences and session history.
6. Withdrawal of consent for future collection without silently deleting
   existing data.
7. Standalone consumer-health-data privacy notice linked from every screen.
8. Standalone wellness and safety disclaimer linked from every screen.
9. Plain-language prototype use terms linked from every screen.
10. Red-flag intake gate and stop/seek-help instructions.
11. Camera-optional, timer-only, and seated alternatives.

## Employer boundary

The employee application contains no team view. Employer reporting is a
separate admin capability and receives participation counts only after opt-in.
It excludes individual concerns, body areas, Better/Same/Worse responses,
sessions, camera, voice, video, and pose data. Cohorts under 10 people are
suppressed.

Participation, camera use, and employer aggregation are voluntary. Individual
wellness information must never be placed in personnel records or used for
employment decisions.

## Regulatory design references

- FDA general-wellness boundary: maintain or encourage a healthy lifestyle
  without diagnosis, treatment, cure, mitigation, or prevention claims.
- FTC health-app practices: clear disclosures, privacy-protective defaults,
  affirmative express consent, truthful representations, and breach planning.
- Washington My Health My Data: standalone consumer-health-data notice,
  purpose-specific consent, access, withdrawal, and deletion rights.
- HHS HIPAA guidance: HIPAA applicability depends on whether the deployment
  involves a covered entity or business associate. FlowReset does not claim
  HIPAA compliance merely because processing is local.
- EEOC workplace-wellness principles: voluntary participation, clear notice,
  confidentiality, and aggregate-only employer information.

## Production blockers

Before any real employer pilot:

- add verified operator identity, privacy contact, request and appeal channels;
- complete jurisdiction-specific legal review and data-protection assessment;
- implement SSO, role-based access, encryption-at-rest, audit logging, signed
  release process, and tested incident/breach response;
- implement and test an automatic retention/deletion schedule, including
  backups and downstream processors;
- complete accessibility, security, penetration, and dependency reviews;
- obtain professional review of the exercise library and validate camera rules
  across varied bodies, clothing, mobility, lighting, and camera placement;
- execute BAAs and HIPAA controls if the deployment creates a covered-entity or
  business-associate relationship;
- prohibit advertising trackers, third-party analytics, and health-data sale.

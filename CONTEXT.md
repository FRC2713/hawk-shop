# Hawk Shop

Hawk Shop tracks parts released for manufacturing by Red Hawk Robotics.

## Language

**Submitter**:
The person who originally released a part for manufacturing. The submitter remains the same when manufacturing work is reassigned.
_Avoid_: Assignee when referring to the submitter

**Assignee**:
The person assigned to manufacture a released part. The assignee may differ from the submitter.

**Submitter notes**:
The submitter's manufacturing notes on a card, such as wall thickness, tolerances or finish, shown to whoever makes the part. Any member can edit them, and editing them does not change the card's status. The cards API still carries them in the legacy field `content`.
_Avoid_: Description, content

**Status**:
The board column containing a manufacturing card. Moving a card to a different column changes its status, including when the move goes backward through the workflow.

**Status notification**:
A message in the team's designated Slack channel reporting a status change and mentioning the submitter when their Slack identity is known.

**Status history**:
The permanent record of a card's status changes; unlike status notifications, it is never deleted.

**Machine queue**:
The parts a machine could make next: Backlog parts assigned to that machine, and Backlog parts in the process queue of any of its processes. Derived, never stored. Parts a mentor positioned come first, in that order, whether assigned or waiting; then its unpositioned assigned parts; then unpositioned waiting parts, each oldest release first, then due date. A waiting part's place is shared by every machine whose queue it is in, and reordering one machine never clears it. A part's place is dropped when its machine changes. A machine in maintenance, or lacking all of a part's processes, can't take that part.
_Avoid_: Machine backlog, job list

**Process queue**:
Backlog parts with a process but no machine, waiting for any machine that does that process ("any 3D printer").
_Avoid_: Unassigned, pool

**Claim**:
To become a part's assignee and move it from Backlog to In Progress in one action, optionally for another member at a shared station. A part claimed from a process queue takes the claiming machine. Unclaiming clears the assignee and returns the part to Backlog, keeping its machine. A part has one claimant: claiming someone else's part fails.
_Avoid_: Take, grab, assign (when the person assigns themselves)

**Send back**:
To return a part from Review with a required reason, to In Progress when it still has an assignee and to Backlog otherwise. The reason is shown on the card and to the submitter.
_Avoid_: Reject, fail

**Slack administrator**:
An active workspace admin or workspace owner in the Red Hawk Robotics Slack workspace. Managing a channel alone does not qualify.

**Project**:
A named piece of work that released parts serve, such as a mechanism, fixture, field element or shop tool. Every card belongs to exactly one project, and it is unrelated to Onshape documents and folders.
_Avoid_: Subsystem, mechanism, document, folder (when referring to a project)

**Miscellaneous**:
The built-in project for one-off parts that serve no named piece of work. It always exists and cannot be renamed or removed.
_Avoid_: No project, unassigned, Other

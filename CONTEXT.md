# Hawk Shop

Hawk Shop tracks parts released for manufacturing by Red Hawk Robotics.

## Language

**Submitter**:
The person who originally released a part for manufacturing. The submitter remains the same when manufacturing work is reassigned.
_Avoid_: Assignee when referring to the submitter

**Assignee**:
The person assigned to manufacture a released part. The assignee may differ from the submitter.

**Status**:
The board column containing a manufacturing card. Moving a card to a different column changes its status, including when the move goes backward through the workflow.

**Status notification**:
A message in the team's designated Slack channel reporting a status change and mentioning the submitter when their Slack identity is known.

**Status history**:
The permanent record of a card's status changes; unlike status notifications, it is never deleted.

**Slack administrator**:
An active workspace admin or workspace owner in the Red Hawk Robotics Slack workspace. Managing a channel alone does not qualify.

**Project**:
A named piece of work that released parts serve, such as a mechanism, fixture, field element or shop tool. Every card belongs to exactly one project, and it is unrelated to Onshape documents and folders.
_Avoid_: Subsystem, mechanism, document, folder (when referring to a project)

**Miscellaneous**:
The built-in project for one-off parts that serve no named piece of work. It always exists and cannot be renamed or removed.
_Avoid_: No project, unassigned, Other

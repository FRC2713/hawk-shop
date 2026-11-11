# Send Slack notifications in the team workspace

Hawk Shop will integrate with the Red Hawk Robotics Slack workspace only. Status notifications will be posted in a channel and mention the person who submitted the affected part. Individuals must not need to install the Slack app; the integration will be installed at the workspace level.

Channel messages keep manufacturing updates visible to the team while drawing the submitter's attention to their parts. Direct messages were considered, but the requested delivery model is shared channel notifications.

The first version publishes notifications with links back to Hawk Shop. It has no Slack commands or status-changing buttons. All notifications go to one configurable channel whose membership includes submitters. The recipient is the original releaser, regardless of the manufacturing assignee. Every move between board columns triggers a notification, including backward moves; reordering within a column and edits to other fields do not.

Submitters moving their own parts do not trigger notifications. (Superseded by [ADR-0003](0003-part-threads.md): every move is posted in the part's thread.) Integration configuration and delivery health belong on a page accessible only to active Red Hawk Robotics Slack workspace administrators and owners, rather than to every signed-in Hawk Shop user. Verify that role with Slack when opening the page and before configuration changes; deny access if verification fails. Keep the bot token in deployment configuration to bootstrap this verification, while administrators manage the channel and enabled state in Hawk Shop.

Match submitters to Slack members by email rather than maintaining manual account mappings. (Superseded once Hawk Suite sign-in arrived: Suite identifies people by Slack member ID, so that ID is used directly and email remains only for cards released before Suite.) Slack requires channel membership for app mentions to notify a member. See [the integration design](../slack-integration.md) for the agreed operational behavior and remaining questions.

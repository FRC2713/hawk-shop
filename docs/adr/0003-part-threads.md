# Thread each part's updates under its release message

Releasing a part posts one rich channel message: part name, quantities, machine, processes, due date, status, release warnings, the submitter's mention, links to Hawk Shop and Onshape, and the thumbnail when one is stored. Every later column move replies in that message's thread, whoever made it, naming who moved it and mentioning the submitter. Deleting the card replies "removed from the board". This supersedes ADR-0001's silent releases, silent self-moves and grouped posts: the thread is the part's history, so the channel holds one message per part and the noise the grouping guarded against stays in threads.

Replies stay in the thread and are not broadcast to the channel; the submitter is notified by the mention. A part released before this change, or while notifications were off, gets its message the first time its status changes.

Thumbnails are uploaded to Slack as private files and referenced by Slack file ID, because Slack cannot fetch images from behind the Suite gateway. Slack messages never spend the Onshape API allocation: if the thumbnail is not already stored, the message goes out without it.

The durable queue keeps per-card order. A reply waits until its part's message exists, and the message timestamp is stored per card and channel so restarts and retries keep replying in the same thread. Changing the destination channel starts new part messages in the new channel.

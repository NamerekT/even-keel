# The built-in tracker

A project's tasks come from a tracker. The built-in one needs nothing; any other needs a **tracker profile**, the account Even Keel signs in with ([Connecting a tracker](tracker-connect.md)). On top of that, a package gives the sessions tools to read and write tasks themselves.

## No account: the built-in tracker

Even Keel has a tracker of its own, kept in its state database: no account, no token, nothing to connect.

It is the first choice of the tracker in the setup and in **Add project**, and the one picked when you have no tracker profile; you give the project only its key (`APP` for `APP-12`). **Status** and **Settings** → **Trackers and CI** always show it.

A built-in project's **Tracker** → **Configure** holds:

- **Chain rules** with only the labels: the built-in tracker's statuses are fixed, so only which labels the chain takes or skips can be changed ([Chain rules](chain.md#chain-rules));
- **Project tasks**, where the milestones you name are created on save;
- **Components**.

A project with another tracker's tasks moves to the built-in one through the import ([Moving from a real tracker](#moving-from-a-real-tracker)), not by switching the tracker field.

For sessions to file and edit its tasks themselves — record decisions, split a task, link a blocker — a project needs the package `tasks@even-keel`, on from the start in a project you add ([With the plugin](tracker-connect.md#with-the-plugin)).

### Milestones

Under **Project tasks** the **Milestone order** block lists every milestone of the project, closed ones folded at the bottom. **+ New milestone** and a row's pencil open its editor: name, status (Planned, Active, Completed, Canceled), target date, description.

- The status is for you: the chain still follows its milestone rules and the tasks' statuses, and closing a milestone with open tasks only warns.
- A rename follows into the project's chain rules and milestone order.
- A milestone with done tasks cannot be deleted — cancel it. Deleting any other moves its open tasks to another milestone or to none, and drops it from the rules and the order.

### Components

**Components** sort a project's tasks by area, at most one a task: create, rename and delete them there, and pick a task's one in its card under **Milestone** (typing a new name there creates it). Deleting a component moves its tasks, closed ones too, to another component or to none. Sessions can set a task's component by name but never create one.

The chain ignores components, except for **Lanes by component** on a project that runs several tasks at once on [machines](hub-machine.md): a task then waits while another task of the same component runs, so tasks at once seldom edit the same files.

### Estimates

The card's **Estimate** has a pencil: type minutes or hours ("20", "1h 20m", "1.5h"), Enter saves, an empty field clears it.

### Attachments and edits

A screenshot or any file becomes the task's attachment when you paste it (Ctrl+V) or drop it into the task's description while you edit it, or pick it with the `+` under it (on a phone it offers Camera, Photos and Files, as the chat does). A picture shows in the text, every file is listed under **Attachments** in the card, and the task's session gets their paths to open.

- The files lie next to the state database, in `state/even-keel/files`, and `npm run storage -- backup` copies them.
- A file over 25 MB is refused; the limit is **Attachment size limit, MB** in **Settings** → **Interface**.

An edit of a task's title or description in its card is saved when you leave the field, close the card or close the tab; only Escape on the title and **Cancel** in the description editor drop it. The browser keeps what you typed until Even Keel has it, so an edit cut off by a closed tab is sent again the next time you open the card, and a note you have not sent waits in its field.

### Change history

The task's journal also records every change of its fields — status, title, description, priority, milestone, estimate, run, labels, parent, links and subtasks — with who made it: you, an agent with its model, or Even Keel itself (a status the chain moved).

One author's changes within five minutes make one entry, a table of each field's old and new value; a description change folds out its difference.

The journal shows the newest entries first, the field for your note right under its heading; **N more** at the bottom shows the older ones. The filter over the journal shows **All**, only **Comments** or only **Changes**. Tasks created before your Even Keel version kept the journal have no history of their earlier changes.

A session reads the history only when it asks for it, so it costs no context otherwise.

## Moving to a real tracker

To take a built-in project to a real tracker, open its **Settings** → **Tracker** and press **Move to another tracker**.

1. **Pick** the tracker profile and the project in it (and a key where the tracker needs one). The window counts what will move (tasks, comments, attachments, links, milestones, labels), shows which status each of your statuses becomes there, and lists what will not move: labels and milestones the tracker lacks (create them there and press **Check again**), priority or estimates it cannot hold, links to closed tasks.
2. **Choose what goes with the tasks.** Both choices hold for the whole copy:
   - **Move the closed tasks too** takes every task, done and canceled ones as well, so the decisions and links behind finished work move with it. Trackers do not accept back-dated tasks: a closed task is created and closed on the day of the copy, and its journal starts with the dates it was created and closed in Even Keel. Everyone subscribed to the project gets a notification for each such task, and on GitHub its limits on creating issues stretch a long move over hours.
   - **Change history as one comment** gives each task one more comment, a table of when, who, which field and its old and new value. Without it the history stays behind: no tracker accepts past changes through its API.
3. **Move** copies the tasks with their statuses, parents, links, attachments and journal; without the first switch, closed ones stay in Even Keel.
4. **Compare.** When the copy ends, Even Keel counts both sides again — only what the tracker keeps — and shows them side by side; a row that did not match is red and names the tasks short of it. **Repeat** brings over what is missing (a task deleted there is created again); **Switch without them** switches as it is.
5. **Switch to <tracker>**, once every task is copied, moves the project: the chain takes its tasks from there in the same order, and the old tasks stay in Even Keel marked "Moved to <key>". The switch waits until the chain no longer works on the project: stop or pause it, and let a task it holds finish.

The switch keeps a report of the transfer: the plan with what did not move, the count of both sides and what was switched without. It stays as long as the project, under **Transfers** on the project's **Tracker** tab, and the event log's line of the switch opens it.

**Who writes there.** Every comment the copy writes, the summary too, comes from the profile's account and starts with who wrote it and when. A personal token always writes as its owner; for the copy to write as a bot, add a profile on the bot's own token:

- GitHub — a GitHub App;
- Linear — an OAuth application;
- GitLab — a project access token;
- Huly or Forgejo — a separate account;
- Jira — a separate user, which takes a paid seat.

**While it runs.** The copy runs in the service: close the window or the tab and come back to it. While it runs, the project's tasks cannot be edited.

- When the tracker takes no more writes for now (its rate limit), the copy waits the time the tracker names, or a pause that grows while it keeps refusing, and goes on by itself; the window says until when it waits. To GitHub it writes no faster than 60 a minute, so a large project takes a while but is not refused.
- A restart of the service breaks the copy off, and it goes on by itself once the service is back.
- A write refused for another reason stops the copy; **Continue** goes on from where it stopped.

## Moving from a real tracker

To bring a project's tasks into the built-in tracker, open its **Settings** → **Tracker** and press **Move to the built-in tracker**. For now Huly, GitHub and Linear give their whole history (GitHub's issues, not its pull requests; Linear's archived issues too, not those in its trash); for the other trackers the button is dimmed and its tip says the import comes in a later release.

1. **The plan.** The window reads the whole project, closed tasks too, and counts what will move — tasks, comments, attachments, links, milestones, labels, components and changes. It shows which status each of the tracker's statuses becomes, and lists what stays behind: links and parents in other projects, time reports, the change history where the tracker gives none, and the milestone fields it does not keep. Milestones move with their target date, status and description, those without tasks too; Linear's have no status and arrive planned, and a closed one without a closing time (Huly's) takes the time its last task closed.

   Keep the window open while it reads: on a big project that takes minutes, and closing the window, or leaving the page, stops the read, so the next opening starts it anew. Once read, the plan is kept for half an hour.
2. **Authors.** Under **Authors** you choose what each author of the tracker's tasks, comments and changes becomes here: the agent, you, or a person under their own name. Each starts as the tracker marks it, and the choice can no longer change once the copy begins. Its **Tasks** column counts the tasks the author created, its **Changes** column their other changes.
3. **Move** copies every task under its own number, with its status, parent, links, attachments, comments with their authors and dates, and the change log. Nothing changes in the tracker, and the chain keeps working with it while the copy runs. The copy runs in the service, as the move the other way: close the window and come back; **Continue** goes on after a stop. When it ends, both sides are counted and shown side by side; **Repeat** brings over what is missing, **Switch without them** switches as it is.
4. **Switch to the built-in tracker** moves the project once the chain no longer works on it, and keeps the transfer's report under **Transfers**. Before the move it brings over the new tasks and those changed in the tracker since the copy (Linear gives no reliable time of a change, so there every task is read again) and counts both sides again; the window shows each step with its count, and you may close it meanwhile.

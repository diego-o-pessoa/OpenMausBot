# Sync from another computer

**Settings → Backups → Sync from another computer** copies everything from one
OpenMausBot (the *source*, for example a Windows desktop) into this one: bots,
standing instructions, skills, memory, group chats, routines, conversations and
files. It runs the same encrypted backup and staged restore as **Export full
backup** and **Import backup**, without a file to carry by hand.

It is one-way and it replaces: each sync makes this installation a copy of the
source. Anything created only here is lost, though the usual safety copy is kept
under `.backups/safety-<restore-id>/data`. Accounts, engine sign-ins and
connections saved on this computer stay as they are, as with any restore, and
routines arrive paused.

## Connecting without HTTPS

Plain HTTP is accepted only for a loopback address (`127.0.0.1`, `localhost`,
`::1`): the local end of an SSH tunnel, which encrypts the traffic. Any other
address needs HTTPS. The desktop server listens on `127.0.0.1:8799`, or on
18799 or 28799 when that one is taken, so keep the tunnel off those three ports
on both computers: a desktop that has to move to another port opens with a new
window origin and loses that window's saved preferences.

Open the tunnel so that a port on **this** computer's loopback reaches the
source's `127.0.0.1:8799`. When this OpenMausBot runs inside a Docker container,
that loopback is the container's, not the Docker host's. Either:

- from inside this computer (or container), with an SSH server on the source:

  ```sh
  ssh -N -L 38799:127.0.0.1:8799 you@windows-pc
  ```

- or from the source, into this computer (or into the container's own SSH
  server):

  ```sh
  ssh -N -R 38799:127.0.0.1:8799 you@linux-box
  ```

Then:

1. On the source, open **Settings → Remote access → Pair a phone or another
   computer**, keep **Full access**, and create a code. It is single-use and
   lasts five minutes.
2. Here, in **Settings → Backups → Sync from another computer**, enter
   `http://127.0.0.1:38799` and the code (or paste the whole pairing link), and
   choose **Connect**.
3. Choose **Sync now**, check the summary, type `REPLACE`, and restart.

The connection is remembered, so later syncs only need **Sync now** while the
tunnel is open. **Disconnect** forgets it here and ends the session on the
source when the tunnel is open; otherwise sign it out there under paired
devices.

The source needs no change: it answers with the pairing and backup routes every
release has. This computer must run the same OpenMausBot version as the source
or a newer one, because a restore refuses a copy made by a newer version.

## Security

- The connection is an admin session on the source, listed there among paired
  devices as `OpenMausBot sync · <this computer's name>` and revocable there.
  It is stored in `workspace-source.json` in this computer's data folder,
  owner-only, never put in a backup, and kept by a restore.
- A chat-only code is refused, and the session it created is ended.
- Every backup is encrypted with a fresh random password, sent to the source
  for that one export and saved nowhere. The source keeps its encrypted copy in
  its `.backups` folder until it
  expires after an hour, and removes it on its next backup request or restart.
- Restoring runs the source's instructions, skills and bot permissions here.
  Only sync from a computer you trust.

## Verification

```sh
node --experimental-strip-types scripts/verify-workspace-sync.ts
pnpm exec vitest run server/workspace-sync-workflow.test.ts server/workspace-source.test.ts \
  server/workspace-backup-http.test.ts src/components/WorkspaceSourceSettings.test.ts
```

The recipe launches two disposable fake-engine servers and a loopback relay in
place of the SSH tunnel. It refuses non-loopback HTTP and a chat-only code,
pairs through the relay, syncs a bot's instructions, memory and conversation,
restarts the destination and checks that the connection survived, syncs again
to bring a bot added later, and checks that **Disconnect** revokes the session
on the source. It does not drive the Settings screen or a real SSH client.

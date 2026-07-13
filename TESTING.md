# AIM v5 acceptance tests

## Preview

1. Run `start-preview.bat` and open `preview.html`.
2. Switch among Student, Faculty, and Admin.
3. Student: open/close each collapsed AIM stage.
4. Student: type in a field and confirm the status changes to a local draft, then automatic save.
5. Student: request advisor removal and confirm the relationship remains pending.
6. Student: add and remove a document link.
7. Faculty: open an advisee plan and add a stage comment.
8. Admin: search All Student Plans.
9. Admin: use searchable student and faculty relationship inputs.
10. Admin: preapprove an email as Administrator.
11. Admin: review the on-screen daily summary.
12. Profile: mute all notifications, then open Notifications.

## Firebase configuration

1. Register a normal `@email.shc.edu` account and confirm Student assignment.
2. Register a normal `@shc.edu` account and confirm Faculty assignment.
3. Register `palitpriyojit@gmail.com` after bootstrap and confirm Student assignment.
4. In Testing mode, register another external address and confirm Pending status.
5. Admin: assign the pending account a role and approve it.
6. Admin: preapprove an unregistered email as Admin, then register that email and confirm Admin access.
7. Change registration to Official mode and confirm an unapproved external address is blocked after verification.

## Plans and autosave

1. Student: type in several fields without pressing Save.
2. Wait 25 seconds and confirm Firestore `plans/{uid}` updates.
3. Type again and close the stage; confirm immediate save.
4. Disconnect the network, type, and confirm a local-draft message.
5. Reopen the plan in the same browser and confirm the draft is restored.
6. Reconnect and save; confirm the local draft clears.
7. Admin: open and edit any student plan.
8. Confirm faculty cannot edit plan text.

## Relationships

1. Student adds a registered faculty member.
2. Student requests removal; confirm relationship stays active.
3. Admin approves/rejects the request.
4. Faculty adds a registered student.
5. Admin creates multiple advisors for one student.
6. Admin creates multiple students for one advisor.
7. Admin enters an unregistered student email and/or advisor email.
8. Confirm `emailApprovals` and `relationshipInvites` are created.
9. Register both users and confirm the pending relationship activates.

## Notifications and audit

1. Student plan save creates/group-updates faculty in-app notification.
2. Faculty comment creates student notification.
3. Document-link change creates advisor notification.
4. Relationship changes create affected-user notifications.
5. Mute a category and confirm new notifications in that category are skipped.
6. Mute all and confirm all AIM activity notifications are skipped.
7. Confirm verification/password-reset emails still work.
8. Admin dashboard shows today's audit counts after activity.

## Security

1. Student cannot read another student's plan directly.
2. Faculty cannot read a student without an active relationship.
3. Student cannot set their own role to Admin.
4. Student cannot directly change a relationship status to removed.
5. Non-admin cannot list preapproved emails.
6. Service-account JSON is not in the repository.
